export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';

const N = (v: any) => Number(v ?? 0);

type Agg = { key: string; name: string; tons: number; revenue: number; cogs: number; profit: number; marginPct: number; profitPerTon: number };

function finish(map: Map<string, Omit<Agg, 'profit' | 'marginPct' | 'profitPerTon'>>): Agg[] {
  return [...map.values()]
    .map(a => {
      const profit = a.revenue - a.cogs;
      return { ...a, profit, marginPct: a.revenue > 0 ? (profit / a.revenue) * 100 : 0, profitPerTon: a.tons > 0 ? profit / a.tons : 0 };
    })
    .sort((a, b) => b.profit - a.profit);
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role?.toLowerCase();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'owner' && role !== 'accountant') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { searchParams } = new URL(request.url);
    const timeframe = (searchParams.get('timeframe') as Timeframe) || '3M';
    const startDate = getStartDateFromTimeframe(timeframe);

    const items = await prisma.saleItem.findMany({
      where: { sale: { isDeleted: false, date: { gte: startDate } } },
      select: {
        productCategory: true, brand: true, wireType: true, qty: true, totalValue: true, rawCopperCostAtSale: true,
        sale: { select: { customerId: true, customer: { select: { name: true } } } }
      }
    });

    const byCustomer = new Map<string, any>();
    const byProduct = new Map<string, any>();
    for (const it of items) {
      const qty = N(it.qty);
      const revenue = N(it.totalValue);
      const cogs = qty * N(it.rawCopperCostAtSale);

      const ck = it.sale.customerId;
      const c = byCustomer.get(ck) ?? { key: ck, name: it.sale.customer.name, tons: 0, revenue: 0, cogs: 0 };
      c.tons += qty; c.revenue += revenue; c.cogs += cogs;
      byCustomer.set(ck, c);

      const label = [it.productCategory, it.brand, it.wireType].filter(Boolean).join(' / ');
      const p = byProduct.get(label) ?? { key: label, name: label, tons: 0, revenue: 0, cogs: 0 };
      p.tons += qty; p.revenue += revenue; p.cogs += cogs;
      byProduct.set(label, p);
    }

    const customers = finish(byCustomer);
    const products = finish(byProduct);
    const total = customers.reduce((t, c) => ({ revenue: t.revenue + c.revenue, cogs: t.cogs + c.cogs, tons: t.tons + c.tons }), { revenue: 0, cogs: 0, tons: 0 });

    return NextResponse.json({
      success: true,
      data: {
        timeframe,
        customers,
        products,
        totals: { ...total, profit: total.revenue - total.cogs },
        note: 'Gross margin = invoice value minus FIFO cost recorded at sale. Excludes credit notes, overhead timing and operating expenses.'
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to build profit report' }, { status: 500 });
  }
}
