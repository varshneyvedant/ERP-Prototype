export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

const N = (v: any) => Number(v ?? 0);
const DAY = 86_400_000;

type Alert = { severity: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; detail: string; href?: string };

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role?.toLowerCase();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'owner' && role !== 'accountant') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY);
    const in7 = new Date(now.getTime() + 7 * DAY);
    const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
    const alerts: Alert[] = [];

    const [purchased, produced, soldRaw, used30, customers, ledgers, saudas, advances, pending, openSales] = await Promise.all([
      prisma.purchase.aggregate({ where: { isDeleted: false }, _sum: { qty: true } }),
      prisma.production.aggregate({ where: { isDeleted: false }, _sum: { rawCopperUsed: true } }),
      prisma.saleItem.aggregate({ where: { sale: { isDeleted: false }, productCategory: 'Raw Copper Bundle' }, _sum: { qty: true } }),
      prisma.production.aggregate({ where: { isDeleted: false, date: { gte: since30 } }, _sum: { rawCopperUsed: true } }),
      prisma.customer.findMany({ select: { id: true, name: true, creditLimit: true } }),
      prisma.customerLedger.groupBy({ by: ['customerId'], where: { isDeleted: false }, _sum: { amount: true } }),
      prisma.saudaContract.findMany({
        where: { status: 'ACTIVE', remainingQty: { gt: 0.001 }, expiryDate: { not: null, lte: in7 } },
        include: { customer: { select: { name: true } } }
      }),
      prisma.employee.findMany({ select: { id: true, name: true, baseSalary: true, advances: { select: { amount: true, amountRepaid: true } } } }),
      prisma.paymentRecord.count({ where: { status: 'PENDING' } }),
      prisma.sale.findMany({
        where: { isDeleted: false },
        select: { date: true, totalValue: true, amountPaid: true, customer: { select: { name: true, creditDays: true } }, creditNotes: { select: { amountCredited: true } } }
      })
    ]);

    // 1. Raw copper runway
    const stock = N(purchased._sum.qty) - (N(produced._sum.rawCopperUsed) + N(soldRaw._sum.qty));
    const daily = N(used30._sum.rawCopperUsed) / 30;
    if (daily > 0) {
      const days = stock / daily;
      if (days < 5) alerts.push({ severity: 'CRITICAL', title: 'Raw copper almost out', detail: `${stock.toFixed(1)}T left ≈ ${Math.max(0, days).toFixed(1)} days at the last-30-day usage rate.`, href: '/manager/purchase' });
      else if (days < 10) alerts.push({ severity: 'WARNING', title: 'Raw copper running low', detail: `${stock.toFixed(1)}T left ≈ ${days.toFixed(1)} days at the last-30-day usage rate.`, href: '/manager/purchase' });
    }

    // 2. Credit limit usage
    const balByCust = new Map(ledgers.map(l => [l.customerId, N(l._sum.amount)]));
    for (const c of customers) {
      const bal = balByCust.get(c.id) ?? 0;
      const limit = N(c.creditLimit);
      if (limit <= 0 || bal <= 0) continue;
      const pct = (bal / limit) * 100;
      if (pct >= 100) alerts.push({ severity: 'CRITICAL', title: `${c.name} is over credit limit`, detail: `Owes ${money(bal)} vs limit ${money(limit)} (${pct.toFixed(0)}%).`, href: `/owner/stakeholders/customer/${c.id}` });
      else if (pct >= 80) alerts.push({ severity: 'WARNING', title: `${c.name} near credit limit`, detail: `Owes ${money(bal)} of ${money(limit)} (${pct.toFixed(0)}%).`, href: `/owner/stakeholders/customer/${c.id}` });
    }

    // 3. Overdue invoices (beyond each customer's own terms)
    let overdueCount = 0, overdueValue = 0, worst = 0;
    for (const s of openSales) {
      const credited = s.creditNotes.reduce((a, c) => a + N(c.amountCredited), 0);
      const out = N(s.totalValue) - credited - N(s.amountPaid);
      if (out <= 0.005) continue;
      const overdue = Math.floor((now.getTime() - s.date.getTime()) / DAY) - (s.customer.creditDays || 18);
      if (overdue > 0) { overdueCount++; overdueValue += out; worst = Math.max(worst, overdue); }
    }
    if (overdueCount > 0) alerts.push({ severity: worst > 30 ? 'CRITICAL' : 'WARNING', title: `${overdueCount} overdue invoice(s)`, detail: `${money(overdueValue)} past terms; worst is ${worst} days late.`, href: '/reports' });

    // 4. Sauda contracts expiring / expired but still holding quantity
    for (const s of saudas) {
      const expired = s.expiryDate! < now;
      alerts.push({
        severity: expired ? 'CRITICAL' : 'WARNING',
        title: `Sauda ${s.contractNo} ${expired ? 'expired' : 'expires soon'}`,
        detail: `${s.customer.name}: ${N(s.remainingQty).toFixed(2)}T still undispatched @ ₹${N(s.ratePerKg)}/kg (expiry ${s.expiryDate!.toISOString().slice(0, 10)}).`,
        href: '/manager/sauda'
      });
    }

    // 5. Heavy employee advances
    for (const e of advances) {
      const pend = e.advances.reduce((a, x) => a + (N(x.amount) - N(x.amountRepaid)), 0);
      const base = N(e.baseSalary);
      if (base > 0 && pend / base >= 2) alerts.push({ severity: pend / base >= 4 ? 'CRITICAL' : 'WARNING', title: `${e.name}: high advances`, detail: `${money(pend)} pending = ${(pend / base).toFixed(1)}x monthly salary.`, href: `/owner/employees/${e.id}` });
    }

    // 6. Payments waiting for approval
    if (pending > 0) alerts.push({ severity: 'INFO', title: `${pending} payment(s) awaiting your approval`, detail: 'Manager-entered payments have no accounting effect until approved.', href: '/owner/dashboard' });

    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

    return NextResponse.json({ success: true, data: { alerts } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to compute alerts' }, { status: 500 });
  }
}
