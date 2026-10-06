import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';


import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const brand = searchParams.get('brand') === 'Unbranded' ? null : searchParams.get('brand');
    const size = searchParams.get('size') === 'N/A' ? null : searchParams.get('size');

    if (!category) return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });

    const productions = await prisma.production.findMany({
      where: { isDeleted: false,
        productCategory: category,
        brand: brand,
        wireType: size || undefined,
      },
      orderBy: { date: 'desc' }
    });

    const sales = await prisma.saleItem.findMany({
      where: { sale: { isDeleted: false },
        productCategory: category,
        brand: brand,
        wireType: size || undefined,
      },
      include: {
        sale: { include: { customer: true } }
      },
      orderBy: { sale: { date: 'desc' } }
    });

    // Merge into one feed
    const feed: any[] = [];

    productions.forEach(p => {
        feed.push({
           id: `prod-${p.id}`,
           date: p.date,
           type: 'PRODUCTION',
           qty: p.wireProduced,
           note: `Produced from ${p.rawCopperUsed.toFixed(2)}T raw copper`
        });
    });

    sales.forEach(s => {
        feed.push({
           id: `sale-${s.id}`,
           date: s.sale.date,
           type: 'SALE',
           qty: s.qty,
           note: `Sold to ${s.sale.customer.name}`
        });
    });

    feed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ success: true, history: feed });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
