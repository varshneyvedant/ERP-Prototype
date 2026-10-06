import { getServerSession, authOptions } from '@/lib/mock-session';
import { ManagerExpensePostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';



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
    const validation = ManagerExpensePostSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { category, amount, description, expenseMonth, date } = validation.data;

    const recordDate = date ? new Date(date) : new Date();
    await assertPeriodNotLocked(recordDate);

    const expense = await prisma.expense.create({
      data: {
        date: recordDate,
        category,
        amount: amount,
        description,
        expenseMonth,
        status: 'PAID'
      }
    });

    // Post Double-Entry Journal Entry
    await prisma.$transaction(async (tx) => {
      await postJournalEntry(tx, {
        date: recordDate,
        description: `Factory Expense Category: ${category} (${description || 'Paid'})`,
        referenceType: 'EXPENSE',
        referenceId: expense.id,
        lines: [
          { accountName: 'Factory Expenses', accountType: 'EXPENSE' as const, debit: Number(amount), credit: 0 },
          { accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: 0, credit: Number(amount) }
        ]
      });
    });

    await logAudit({
      action: 'CREATE',
      module: 'Expense',
      description: `Logged factory expense of ₹${amount} in category '${category}'`,
      details: { id: expense.id, category, amount, description, expenseMonth }
    });

    return NextResponse.json({ success: true, expense });
  } catch (error) {
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
