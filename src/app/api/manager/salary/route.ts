import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';

import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';

const SalaryPostSchema = z.object({
  employeeId: z.string().uuid(),
  amountToPay: z.coerce.number().min(0).max(100_000_000),
  deductAdvanceAmount: z.coerce.number().min(0).max(100_000_000).optional().default(0),
  monthYear: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'monthYear must be YYYY-MM'),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  // Salary is cash leaving the business -> Owner only (no approval workflow exists for it yet).
  if (!session?.user || (session.user as any).role?.toLowerCase() !== 'owner') {
    return NextResponse.json({ error: 'Unauthorized: Owner role required to process salary.' }, { status: 401 });
  }

  try {
    const parsed = SalaryPostSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data', details: parsed.error.format() }, { status: 400 });
    }
    const { employeeId, amountToPay, deductAdvanceAmount, monthYear } = parsed.data;

    if (amountToPay + deductAdvanceAmount <= 0) {
      return NextResponse.json({ error: 'Nothing to pay or deduct.' }, { status: 400 });
    }

    const now = new Date();
    await assertPeriodNotLocked(now);

    const result = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!employee) throw new Error('Employee not found');

      // Duplicate guard: one salary run per employee per month
      const existing = await tx.salaryHistory.findFirst({
        where: { employeeId, reason: { startsWith: `Salary for ${monthYear}` } },
        select: { id: true }
      });
      if (existing) {
        throw new Error(`Salary for ${monthYear} has already been processed for ${employee.name}.`);
      }

      // Deduct from pending advances (oldest first) - capped at what is ACTUALLY pending
      let actualDeducted = 0;
      if (deductAdvanceAmount > 0) {
        let remaining = deductAdvanceAmount;
        const advances = await tx.advance.findMany({ where: { employeeId }, orderBy: { date: 'asc' } });
        for (const adv of advances) {
          if (remaining <= 0) break;
          const pending = Number(adv.amount) - Number(adv.amountRepaid);
          if (pending <= 0) continue;
          const take = Math.min(pending, remaining);
          await tx.advance.update({ where: { id: adv.id }, data: { amountRepaid: Number(adv.amountRepaid) + take } });
          await tx.advanceRepayment.create({ data: { advanceId: adv.id, amount: take, date: now } });
          remaining -= take;
          actualDeducted += take;
        }
        if (actualDeducted + 0.005 < deductAdvanceAmount) {
          throw new Error(`Cannot deduct ₹${deductAdvanceAmount}: only ₹${actualDeducted.toFixed(2)} of advances are pending for ${employee.name}.`);
        }
      }

      const totalGross = amountToPay + actualDeducted;

      const history = await tx.salaryHistory.create({
        data: {
          employeeId,
          date: now,
          amount: totalGross,
          reason: `Salary for ${monthYear} (Paid: ₹${amountToPay}, Deducted Advance: ₹${actualDeducted})`
        }
      });

      // Mirror into Expenses (gross) so dashboards / cash-in-hand / expense breakdown stay correct.
      // Journal is posted below under 'Salary Expense' (this row deliberately has no journal of its own).
      await tx.expense.create({
        data: {
          date: now,
          category: 'Salaries',
          amount: totalGross,
          description: `Salary ${monthYear} - ${employee.name}`,
          expenseMonth: monthYear,
          status: 'PAID'
        }
      });

      const lines: { accountName: string; accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'; debit: number; credit: number; }[] = [
        { accountName: 'Salary Expense', accountType: 'EXPENSE', debit: totalGross, credit: 0 },
      ];
      if (amountToPay > 0) lines.push({ accountName: 'Cash & Bank', accountType: 'ASSET', debit: 0, credit: amountToPay });
      if (actualDeducted > 0) lines.push({ accountName: 'Employee Advances', accountType: 'ASSET', debit: 0, credit: actualDeducted });

      await postJournalEntry(tx, {
        date: now,
        description: `Salary Payout to ${employee.name} (${monthYear})`,
        referenceType: 'EXPENSE',
        referenceId: history.id,
        lines
      });

      return { history, totalGross, actualDeducted };
    });

    await logAudit({
      action: 'CREATE',
      module: 'Salary',
      description: `Processed salary of ₹${result.totalGross} for employee ID ${employeeId} (${monthYear})`,
      details: { employeeId, totalGross: result.totalGross, paid: amountToPay, deducted: result.actualDeducted }
    });

    return NextResponse.json({ success: true, salary: result.history });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
