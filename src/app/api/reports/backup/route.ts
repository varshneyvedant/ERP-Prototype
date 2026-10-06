import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';


import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';

type Cell = string | number | boolean | Date | null | undefined | { toString(): string };

function csv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    // Neutralise spreadsheet formula injection
    if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n') + '\r\n';
}

const TABLES: Record<string, () => Promise<{ headers: string[]; rows: Cell[][] }>> = {
  sales: async () => {
    const d = await prisma.saleItem.findMany({ include: { sale: { include: { customer: { select: { name: true } } } } }, orderBy: { sale: { date: 'asc' } } });
    return {
      headers: ['sale_id', 'date', 'customer', 'category', 'brand', 'wire_type', 'qty_tons', 'price_per_ton', 'line_total', 'fifo_cost_per_ton', 'invoice_total', 'amount_paid', 'deleted'],
      rows: d.map(i => [i.saleId, i.sale.date, i.sale.customer.name, i.productCategory, i.brand, i.wireType, i.qty, i.pricePerTon, i.totalValue, i.rawCopperCostAtSale, i.sale.totalValue, i.sale.amountPaid, i.sale.isDeleted])
    };
  },
  purchases: async () => {
    const d = await prisma.purchase.findMany({ include: { supplier: { select: { name: true } } }, orderBy: { date: 'asc' } });
    return { headers: ['id', 'date', 'supplier', 'qty_tons', 'price_per_ton', 'total', 'amount_paid', 'deleted'], rows: d.map(p => [p.id, p.date, p.supplier.name, p.qty, p.pricePerTon, p.totalValue, p.amountPaid, p.isDeleted]) };
  },
  production: async () => {
    const d = await prisma.production.findMany({ include: { finishedGoodsBatch: true }, orderBy: { date: 'asc' } });
    return { headers: ['id', 'date', 'category', 'brand', 'wire_type', 'raw_used_t', 'wire_produced_t', 'scrap_t', 'overhead', 'cost_per_ton', 'deleted'], rows: d.map(p => [p.id, p.date, p.productCategory, p.brand, p.wireType, p.rawCopperUsed, p.wireProduced, p.scrapGenerated, p.estimatedOverhead, p.finishedGoodsBatch?.costPerTon, p.isDeleted]) };
  },
  expenses: async () => {
    const d = await prisma.expense.findMany({ orderBy: { date: 'asc' } });
    return { headers: ['id', 'date', 'category', 'amount', 'description', 'month', 'status', 'deleted'], rows: d.map(e => [e.id, e.date, e.category, e.amount, e.description, e.expenseMonth, e.status, e.isDeleted]) };
  },
  payments: async () => {
    const d = await prisma.paymentRecord.findMany({ include: { customer: { select: { name: true } }, supplier: { select: { name: true } } }, orderBy: { date: 'asc' } });
    return { headers: ['id', 'date', 'type', 'status', 'amount', 'customer', 'supplier', 'description'], rows: d.map(p => [p.id, p.date, p.type, p.status, p.amount, p.customer?.name, p.supplier?.name, p.description]) };
  },
  journals: async () => {
    const d = await prisma.journalLine.findMany({ include: { journalEntry: true }, orderBy: { journalEntry: { date: 'asc' } } });
    return { headers: ['entry_id', 'date', 'description', 'ref_type', 'ref_id', 'account', 'account_type', 'debit', 'credit'], rows: d.map(l => [l.journalEntryId, l.journalEntry.date, l.journalEntry.description, l.journalEntry.referenceType, l.journalEntry.referenceId, l.accountName, l.accountType, l.debit, l.credit]) };
  },
  customers: async () => {
    const [d, led] = await Promise.all([prisma.customer.findMany(), prisma.customerLedger.groupBy({ by: ['customerId'], where: { isDeleted: false }, _sum: { amount: true } })]);
    const bal = new Map(led.map(l => [l.customerId, l._sum.amount]));
    return { headers: ['id', 'name', 'contact', 'gst', 'credit_limit', 'credit_days', 'outstanding_per_ledger'], rows: d.map(c => [c.id, c.name, c.contact, c.gst, c.creditLimit, c.creditDays, bal.get(c.id) ?? 0]) };
  },
  suppliers: async () => {
    const [d, led] = await Promise.all([prisma.supplier.findMany(), prisma.supplierLedger.groupBy({ by: ['supplierId'], where: { isDeleted: false }, _sum: { amount: true } })]);
    const bal = new Map(led.map(l => [l.supplierId, l._sum.amount]));
    return { headers: ['id', 'name', 'contact', 'gst', 'payable_per_ledger'], rows: d.map(s => [s.id, s.name, s.contact, s.gst, bal.get(s.id) ?? 0]) };
  },
  employees: async () => {
    const d = await prisma.employee.findMany({ include: { advances: true } });
    return { headers: ['id', 'name', 'role', 'base_salary', 'pending_advance'], rows: d.map(e => [e.id, e.name, e.role, e.baseSalary, e.advances.reduce((a, x) => a + (Number(x.amount) - Number(x.amountRepaid)), 0)]) };
  }
};

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Full-database export: owner only (accountant is read-only on reports, not bulk export)
  if ((session.user as any).role?.toLowerCase() !== 'owner') {
    return NextResponse.json({ error: 'Forbidden: Owner role required for data export' }, { status: 403 });
  }

  const table = new URL(request.url).searchParams.get('table') || '';
  if (!(table in TABLES)) {
    return NextResponse.json({ error: `Unknown table. Use one of: ${Object.keys(TABLES).join(', ')}` }, { status: 400 });
  }

  try {
    const { headers, rows } = await TABLES[table]();
    await logAudit({ action: 'CREATE', module: 'Export', description: `Exported ${table} (${rows.length} rows) as CSV`, details: { table, rows: rows.length } });
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse('\uFEFF' + csv(headers, rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="export-${table}-${stamp}.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
