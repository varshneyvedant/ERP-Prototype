import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




import { prisma } from '@/lib/prisma';


import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';



export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as any).role?.toLowerCase() !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const timeframe = (searchParams.get('timeframe') as Timeframe) || '1M';
    const startDate = getStartDateFromTimeframe(timeframe);
    const endDate = new Date();

    const salesItems = await prisma.saleItem.findMany({
      where: { sale: { isDeleted: false, date: { gte: startDate, lte: endDate } } },
      include: { sale: { include: { customer: true } } }
    });

    // Build the hierarchical Tree: Category -> Brand -> metrics
    const tree: any = {};

    salesItems.forEach(item => {
      const cat = item.productCategory;
      const brand = item.brand || 'Unbranded / Raw';

      if (!tree[cat]) {
        tree[cat] = {
          categoryName: cat,
          totalRevenue: 0,
          totalTons: 0,
          totalGrossProfit: 0,
          brands: {}
        };
      }

      if (!tree[cat].brands[brand]) {
        tree[cat].brands[brand] = {
          brandName: brand,
          totalRevenue: 0,
          totalTons: 0,
          totalGrossProfit: 0,
          customers: {}
        };
      }

      // Exact Cost Calculation using the frozen `rawCopperCostAtSale`
      const itemCost = Number(item.qty) * Number(item.rawCopperCostAtSale);
      const itemGrossProfit = Number(item.totalValue) - itemCost;

      // Update Category level
      tree[cat].totalRevenue += Number(item.totalValue);
      tree[cat].totalTons += Number(item.qty);
      tree[cat].totalGrossProfit += itemGrossProfit;

      // Update Brand level
      tree[cat].brands[brand].totalRevenue += Number(item.totalValue);
      tree[cat].brands[brand].totalTons += Number(item.qty);
      tree[cat].brands[brand].totalGrossProfit += itemGrossProfit;

      // Track Top Customers for this brand
      const custName = item.sale.customer.name;
      tree[cat].brands[brand].customers[custName] = (tree[cat].brands[brand].customers[custName] || 0) + Number(item.qty);
    });

    // Transform Object tree into Array tree for easier frontend mapping
    const finalTree = Object.values(tree).map((c: any) => ({
      ...c,
      avgSellingPrice: c.totalTons > 0 ? (c.totalRevenue / c.totalTons) : 0,
      avgProfitPerTon: c.totalTons > 0 ? (c.totalGrossProfit / c.totalTons) : 0,
      marginPercent: c.totalRevenue > 0 ? ((c.totalGrossProfit / c.totalRevenue) * 100) : 0,
      brandsList: Object.values(c.brands).map((b: any) => ({
         ...b,
         avgSellingPrice: b.totalTons > 0 ? (b.totalRevenue / b.totalTons) : 0,
         avgProfitPerTon: b.totalTons > 0 ? (b.totalGrossProfit / b.totalTons) : 0,
         marginPercent: b.totalRevenue > 0 ? ((b.totalGrossProfit / b.totalRevenue) * 100) : 0,
         topCustomers: Object.entries(b.customers)
            .map(([name, qty]) => ({ name, qty: qty as number }))
            .sort((x, y) => y.qty - x.qty)
            .slice(0, 3) // Top 3
      }))
    }));

    return NextResponse.json({ success: true, tree: finalTree });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
