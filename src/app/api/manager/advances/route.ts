import { ManagerAdvancePostSchema, ManagerAdvancePutSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';


import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';



export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const empId = searchParams.get('empId');
    if (!empId) return NextResponse.json({ error: 'Missing employee ID' }, { status: 400 });

    const employee = await prisma.employee.findUnique({
      where: { id: empId },
      include: { advances: true }
    });

    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const totalAdvances = employee.advances.reduce((sum, a) => sum + (Number(a.amount) - Number(a.amountRepaid)), 0);
    const monthsAdvance = Number(employee.baseSalary) > 0 ? (totalAdvances / Number(employee.baseSalary)) : 0;

    let recommendation = "Safe to approve advance.";
    let recommendColor = "text-green-500";
    let isWarning = false;

    if (monthsAdvance >= 4) {
       recommendation = "CRITICAL WARNING: Employee already has more than 4 months of pending advances. DO NOT APPROVE further advances until existing debt is cleared.";
       recommendColor = "text-red-500";
       isWarning = true;
    } else if (monthsAdvance > 2) {
       recommendation = "Warning: Employee has over 2 months of pending advances. Proceed with caution.";
       recommendColor = "text-orange-500";
       isWarning = true;
    }

    return NextResponse.json({
      success: true,
      data: {
        totalAdvances,
        monthsAdvance: monthsAdvance.toFixed(1),
        recommendation,
        recommendColor,
        isWarning,
        advances: employee.advances
      }
    });
  } catch (error) {
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden. Owner approval required.' }, { status: 403 });
  }

  try {
    const body = await request.json();

    // Check if this is a repayment
    if (body.action === 'REPAY') {
        const validation = ManagerAdvancePutSchema.safeParse(body);
        if (!validation.success) {
          return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
        }
        const { employeeId, amount } = validation.data;
        let remainingRepayment = amount;

        // Fetch all advances for this employee, then filter for ones with remaining balance
        const allAdvances = await prisma.advance.findMany({
          where: {
            employeeId,
          },
          orderBy: { date: 'asc' }
        });
        const pendingAdvances = allAdvances.filter(
          a => Number(a.amountRepaid) < Number(a.amount)
        );

        // Period Lock Check
        await assertPeriodNotLocked(new Date());

        await prisma.$transaction(async (tx) => {
          for (const advance of pendingAdvances) {
             if (remainingRepayment <= 0) break;

             const pending = Number(advance.amount) - Number(advance.amountRepaid);
             const payToThisAdvance = Math.min(pending, remainingRepayment);

             await tx.advance.update({
                 where: { id: advance.id },
                 data: { amountRepaid: Number(advance.amountRepaid) + payToThisAdvance }
             });

             await tx.advanceRepayment.create({
                 data: {
                    advanceId: advance.id,
                    amount: payToThisAdvance,
                    date: new Date()
                 }
             });

             remainingRepayment -= payToThisAdvance;
          }

          // Post Double-Entry Journal Entry (capped to actual amount repaid)
          const actualRepaid = amount - remainingRepayment;
          const employee = await tx.employee.findUnique({ where: { id: employeeId } });
          const empName = employee ? employee.name : 'Employee';

          if (actualRepaid > 0) {
            await postJournalEntry(tx, {
              date: new Date(),
              description: `Salary Advance Repayment from ${empName}`,
              referenceType: 'ADVANCE',
              referenceId: employeeId,
              lines: [
                { accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: actualRepaid, credit: 0 },
                { accountName: 'Employee Advances', accountType: 'ASSET' as const, debit: 0, credit: actualRepaid }
              ]
            });
          }
        });

        await logAudit({
          action: 'CREATE',
          module: 'AdvanceRepayment',
          description: `Logged employee repayment of ₹${amount} for employee ID ${employeeId}`,
          details: { employeeId, amount }
        });

        return NextResponse.json({ success: true });
    }

    // Normal advance creation
    const validation = ManagerAdvancePostSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { employeeId, amount, reason, date } = validation.data;
    const recordDate = date ? new Date(date) : new Date();
    await assertPeriodNotLocked(recordDate);

    const result = await prisma.$transaction(async (tx) => {
      const adv = await tx.advance.create({
        data: {
          employeeId,
          date: recordDate,
          amount: amount,
          reason
        }
      });

      const employee = await tx.employee.findUnique({ where: { id: employeeId } });
      const empName = employee ? employee.name : 'Employee';

      await postJournalEntry(tx, {
        date: recordDate,
        description: `Salary Advance to ${empName} (${reason || 'Advance'})`,
        referenceType: 'ADVANCE',
        referenceId: adv.id,
        lines: [
          { accountName: 'Employee Advances', accountType: 'ASSET' as const, debit: Number(amount), credit: 0 },
          { accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: 0, credit: Number(amount) }
        ]
      });

      return adv;
    });

    await logAudit({
      action: 'CREATE',
      module: 'Advance',
      description: `Logged employee advance of ₹${amount} for employee ID ${employeeId}. Reason: ${reason || 'N/A'}`,
      details: { id: result.id, employeeId, amount, reason }
    });

    return NextResponse.json({ success: true, advance: result });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
