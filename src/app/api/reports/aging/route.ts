export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

const N = (v: any) => Number(v ?? 0);
const DAY = 86_400_000;

type Row = { id: string; name: string; notDue: number; d1_30: number; d31_60: number; d60plus: number; total: number; oldestDays: number };

function emptyRow(id: string, name: string): Row {
  return { id, name, notDue: 0, d1_30: 0, d31_60: 0, d60plus: 0, total: 0, oldestDays: 0 };
}

function place(row: Row, outstanding: number, overdueDays: number, ageDays: number) {
  if (overdueDays <= 0) row.notDue += outstanding;
  else if (overdueDays <= 30) row.d1_30 += outstanding;
  else if (overdueDays <= 60) row.d31_60 += outstanding;
  else row.d60plus += outstanding;
  row.total += outstanding;
  if (overdueDays > 0 && ageDays > row.oldestDays) row.oldestDays = ageDays;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role?.toLowerCase();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'owner' && role !== 'accountant') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const now = Date.now();

    const [sales, purchases] = await Promise.all([
      prisma.sale.findMany({
        where: { isDeleted: false },
        select: {
          id: true, date: true, totalValue: true, amountPaid: true, customerId: true,
          customer: { select: { name: true, creditDays: true } },
          creditNotes: { select: { amountCredited: true } }
        }
      }),
      prisma.purchase.findMany({
        where: { isDeleted: false },
        select: {
          id: true, date: true, totalValue: true, amountPaid: true, supplierId: true,
          supplier: { select: { name: true } },
          debitNotes: { select: { amountDebited: true } }
        }
      })
    ]);

    // Receivables: overdue measured against each customer's own credit terms
    const recv = new Map<string, Row>();
    for (const s of sales) {
      const credited = s.creditNotes.reduce((a, c) => a + N(c.amountCredited), 0);
      const outstanding = Math.round((N(s.totalValue) - credited - N(s.amountPaid)) * 100) / 100;
      if (outstanding <= 0.005) continue;
      const age = Math.floor((now - s.date.getTime()) / DAY);
      const terms = s.customer.creditDays || 18;
      const row = recv.get(s.customerId) ?? emptyRow(s.customerId, s.customer.name);
      place(row, outstanding, age - terms, age);
      recv.set(s.customerId, row);
    }

    // Payables: measured from bill date (no supplier credit terms stored)
    const pay = new Map<string, Row>();
    for (const p of purchases) {
      const debited = p.debitNotes.reduce((a, d) => a + N(d.amountDebited), 0);
      const outstanding = Math.round((N(p.totalValue) - debited - N(p.amountPaid)) * 100) / 100;
      if (outstanding <= 0.005) continue;
      const age = Math.floor((now - p.date.getTime()) / DAY);
      const row = pay.get(p.supplierId) ?? emptyRow(p.supplierId, p.supplier.name);
      place(row, outstanding, age - 30, age); // assume 30-day supplier terms
      pay.set(p.supplierId, row);
    }

    const sum = (rows: Row[]) =>
      rows.reduce(
        (t, r) => ({
          notDue: t.notDue + r.notDue, d1_30: t.d1_30 + r.d1_30, d31_60: t.d31_60 + r.d31_60,
          d60plus: t.d60plus + r.d60plus, total: t.total + r.total
        }),
        { notDue: 0, d1_30: 0, d31_60: 0, d60plus: 0, total: 0 }
      );

    const receivables = [...recv.values()].sort((a, b) => b.total - a.total);
    const payables = [...pay.values()].sort((a, b) => b.total - a.total);

    return NextResponse.json({
      success: true,
      data: {
        receivables: { rows: receivables, totals: sum(receivables) },
        payables: { rows: payables, totals: sum(payables), termsNote: 'Supplier terms assumed 30 days (not stored per supplier).' }
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to build aging report' }, { status: 500 });
  }
}
