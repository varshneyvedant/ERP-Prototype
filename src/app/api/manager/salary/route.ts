export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !['manager', 'owner'].includes((session.user as any).role?.toLowerCase())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { employeeId, amountToPay, deductAdvanceAmount, monthYear } = await request.json();
    if (!employeeId || !amountToPay || !monthYear) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const payNum = Number(amountToPay);
    const deductNum = Number(deductAdvanceAmount || 0);
    const totalGross = payNum + deductNum;

    if (payNum < 0 || deductNum < 0) return NextResponse.json({ error: 'Amounts must be positive' }, { status: 400 });

    await assertPeriodNotLocked(new Date());

    const result = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!employee) throw new Error('Employee not found');

      // Deduct from advances if requested
      if (deductNum > 0) {
        let remainingDeduct = deductNum;
        const pendingAdvances = await tx.advance.findMany({
          where: { employeeId },
          orderBy: { date: 'asc' }
        });

        for (const adv of pendingAdvances) {
          if (remainingDeduct <= 0) break;
          const pending = Number(adv.amount) - Number(adv.amountRepaid);
          if (pending > 0) {
             const payToThis = Math.min(pending, remainingDeduct);
             await tx.advance.update({
                 where: { id: adv.id },
                 data: { amountRepaid: Number(adv.amountRepaid) + payToThis }
             });
             await tx.advanceRepayment.create({
                 data: { advanceId: adv.id, amount: payToThis, date: new Date() }
             });
             remainingDeduct -= payToThis;
          }
        }
      }

      // Log salary history
      const history = await tx.salaryHistory.create({
        data: {
           employeeId,
           date: new Date(),
           amount: totalGross,
           reason: `Salary for ${monthYear} (Paid: ₹${payNum}, Deducted Advance: ₹${deductNum})`
        }
      });

      // Post Journal Entry
      const lines = [
        { accountName: 'Salary Expense', accountType: 'EXPENSE' as const, debit: totalGross, credit: 0 },
      ];
      if (payNum > 0) {
        lines.push({ accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: 0, credit: payNum });
      }
      if (deductNum > 0) {
        lines.push({ accountName: 'Employee Advances', accountType: 'ASSET' as const, debit: 0, credit: deductNum });
      }

      await postJournalEntry(tx, {
        date: new Date(),
        description: `Salary Payout to ${employee.name} (${monthYear})`,
        referenceType: 'EXPENSE' as any,
        referenceId: history.id,
        lines
      });

      return history;
    });

    await logAudit({
      action: 'CREATE',
      module: 'Salary',
      description: `Processed salary of ₹${totalGross} for employee ID ${employeeId}`,
      details: { employeeId, totalGross, paid: payNum, deducted: deductNum }
    });

    return NextResponse.json({ success: true, salary: result });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
