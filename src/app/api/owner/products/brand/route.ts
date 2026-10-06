import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




import { prisma } from '@/lib/prisma';


import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';


import { format, eachMonthOfInterval, eachDayOfInterval, eachYearOfInterval, startOfDay, isSameMonth, isSameYear } from 'date-fns';



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
    // Brand name is passed URL-encoded
    const brandParam = searchParams.get('brand');
    const decodedParam = decodeURIComponent(brandParam || '');
    const isRawCopper = decodedParam === 'RawCopper';
    const brand = isRawCopper ? null : decodedParam;

    const startDate = getStartDateFromTimeframe(timeframe);
    const endDate = new Date();

    // 1. Fetch exact brand items in timeframe
    const brandItems = await prisma.saleItem.findMany({
      where: {
         ...(isRawCopper ? { productCategory: 'Raw Copper Bundle' } : { brand: brand }),
         sale: { isDeleted: false, date: { gte: startDate, lte: endDate } }
      },
      include: { sale: { include: { customer: true } } },
      orderBy: { sale: { date: 'desc' } }
    });

    // 2. Aggregate Company Data for % comparisons
    const allCompanyItems = await prisma.saleItem.findMany({
      where: { sale: { isDeleted: false, date: { gte: startDate, lte: endDate } } }
    });

    let totalCompanyRevenue = 0;
    let totalCompanyGrossProfit = 0;
    allCompanyItems.forEach(item => {
       totalCompanyRevenue += Number(item.totalValue);
       totalCompanyGrossProfit += (Number(item.totalValue) - (Number(item.qty) * Number(item.rawCopperCostAtSale)));
    });

    // 3. Process Brand Data
    let totalBrandRevenue = 0;
    let totalBrandGrossProfit = 0;
    let totalBrandVolume = 0;

    // Track Buyers
    const buyersMap: Record<string, { qty: number, revenue: number, profit: number }> = {};

    brandItems.forEach(item => {
       const cost = Number(item.qty) * Number(item.rawCopperCostAtSale);
       const profit = Number(item.totalValue) - cost;

       totalBrandRevenue += Number(item.totalValue);
       totalBrandGrossProfit += profit;
       totalBrandVolume += Number(item.qty);

       const custName = item.sale.customer.name;
       if (!buyersMap[custName]) buyersMap[custName] = { qty: 0, revenue: 0, profit: 0 };
       buyersMap[custName].qty += Number(item.qty);
       buyersMap[custName].revenue += Number(item.totalValue);
       buyersMap[custName].profit += profit;
    });

    // Format Buyers Table
    const buyers = Object.entries(buyersMap).map(([name, data]) => ({
       name,
       volume: data.qty,
       brandRevPercent: totalBrandRevenue > 0 ? (data.revenue / totalBrandRevenue) * 100 : 0,
       compRevPercent: totalCompanyRevenue > 0 ? (data.revenue / totalCompanyRevenue) * 100 : 0,
       brandProfPercent: totalBrandGrossProfit > 0 ? (data.profit / totalBrandGrossProfit) * 100 : 0,
       compProfPercent: totalCompanyGrossProfit > 0 ? (data.profit / totalCompanyGrossProfit) * 100 : 0,
    })).sort((a, b) => b.volume - a.volume); // Sort by volume

    // Format Order History
    const history = brandItems.map(item => {
       const cost = Number(item.qty) * Number(item.rawCopperCostAtSale);
       const profit = Number(item.totalValue) - cost;
       const margin = Number(item.totalValue) > 0 ? (profit / Number(item.totalValue)) * 100 : 0;
       const isFullyPaid = Number(item.sale.amountPaid) >= Number(item.sale.totalValue);

       return {
          id: item.id,
          date: item.sale.date,
          customer: item.sale.customer.name,
          size: item.wireType || '-',
          qty: item.qty,
          sellingPrice: item.pricePerTon,
          costPrice: item.rawCopperCostAtSale,
          margin,
          totalProfit: profit,
          totalRevenue: item.totalValue,
          isFullyPaid
       };
    });

    // 4. Trend Chart Data
    let intervals: Date[] = [];
    let formatStr = '';
    let isDay = false, isMonth = false, isYear = false;

    if (['1W', '1M'].includes(timeframe)) {
       intervals = eachDayOfInterval({ start: startDate, end: endDate });
       formatStr = 'dd MMM';
       isDay = true;
    } else if (['3M', '6M', '1Y', 'FY'].includes(timeframe)) {
       intervals = eachMonthOfInterval({ start: startDate, end: endDate });
       formatStr = 'MMM yyyy';
       isMonth = true;
    } else {
       let finalStart = startDate;
       if (timeframe === 'ALL') {
          const firstSale = await prisma.sale.findFirst({ orderBy: { date: 'asc' }});
          finalStart = firstSale ? firstSale.date : new Date(new Date().getFullYear() - 3, 0, 1);
       }
       intervals = eachYearOfInterval({ start: finalStart, end: endDate });
       formatStr = 'yyyy';
       isYear = true;
    }

    const trends = intervals.map(intervalDate => {
       let itemsInInterval: typeof brandItems = [];
       if (isDay) itemsInInterval = brandItems.filter(x => startOfDay(x.sale.date).getTime() === startOfDay(intervalDate).getTime());
       else if (isMonth) itemsInInterval = brandItems.filter(x => isSameMonth(x.sale.date, intervalDate));
       else if (isYear) itemsInInterval = brandItems.filter(x => isSameYear(x.sale.date, intervalDate));

       let rev = 0;
       let prof = 0;
       itemsInInterval.forEach(item => {
           rev += Number(item.totalValue);
           prof += (Number(item.totalValue) - (Number(item.qty) * Number(item.rawCopperCostAtSale)));
       });

       return {
          period: format(intervalDate, formatStr),
          Revenue: rev,
          GrossProfit: prof
       };
    });

    return NextResponse.json({
      success: true,
      data: {
        brandName: isRawCopper ? 'Raw Copper Bundle' : decodedParam,
        totalBrandRevenue,
        totalBrandGrossProfit,
        totalBrandVolume,
        buyers,
        history,
        trends
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
