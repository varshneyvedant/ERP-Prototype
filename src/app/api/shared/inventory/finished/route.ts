import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';


import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // We calculate current physical stock of finished goods exactly:
    // Total Produced - Total Sold (for each category, brand, size)

    const production = await prisma.production.groupBy({
        where: { isDeleted: false },
        by: ['productCategory', 'brand', 'wireType'],
        _sum: { wireProduced: true }
    });

    const sales = await prisma.saleItem.groupBy({
        where: { sale: { isDeleted: false } },
        by: ['productCategory', 'brand', 'wireType'],
        _sum: { qty: true }
    });

    // Build map for easy subtraction
    const salesMap: Record<string, number> = {};
    sales.forEach(s => {
        const key = `${s.productCategory}-${s.brand || ''}-${s.wireType || ''}`;
        salesMap[key] = Number(s._sum.qty || 0);
    });

    // Build hierarchical tree: Category -> Brand -> Size -> Stock
    const tree: any = {};

    production.forEach(p => {
        const cat = p.productCategory;
        const brand = p.brand || 'Unbranded';
        const size = p.wireType || 'N/A';
        const produced = Number(p._sum.wireProduced || 0);

        const key = `${cat}-${p.brand || ''}-${size === 'N/A' ? '' : size}`;
        const sold = salesMap[key] || 0;
        const available = produced - sold;

        // Skip items that have absolutely 0 stock or are negative due to historical adjustments
        if (available <= 0) return;

        if (!tree[cat]) tree[cat] = { name: cat, totalStock: 0, brands: {} };

        if (!tree[cat].brands[brand]) tree[cat].brands[brand] = { name: brand, totalStock: 0, sizes: [] };

        tree[cat].brands[brand].sizes.push({
            size,
            produced,
            sold,
            available
        });

        // Rollup totals
        tree[cat].brands[brand].totalStock += available;
        tree[cat].totalStock += available;
    });

    // Convert object maps to arrays for the frontend
    const finalTree = Object.values(tree).map((c: any) => ({
        name: c.name,
        totalStock: c.totalStock,
        brands: Object.values(c.brands).map((b: any) => ({
            name: b.name,
            totalStock: b.totalStock,
            sizes: b.sizes.sort((x: any, y: any) => y.available - x.available)
        })).sort((x: any, y: any) => y.totalStock - x.totalStock)
    })).sort((x: any, y: any) => y.totalStock - x.totalStock);

    return NextResponse.json({ success: true, tree: finalTree });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
