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
    const id = searchParams.get('id');
    const timeframe = (searchParams.get('timeframe') as Timeframe) || '1M';

    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const startDate = getStartDateFromTimeframe(timeframe);

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        sales: {
          where: { date: { gte: startDate } },
          include: { items: true },
          orderBy: { date: 'desc' }
        },
        ledgers: true // Fetch all for static balance
      }
    });

    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    const paymentRecords = await prisma.paymentRecord.findMany({
      where: { customerId: id, type: 'INCOMING', date: { gte: startDate } },
      orderBy: { date: 'desc' }
    });

    // Payment Cycle Duration Calculation
    let totalPaymentTimeMs = 0;
    let completedOrdersCount = 0;
    let fastestPaymentMs = Infinity;
    let slowestPaymentMs = 0;

    customer.sales.forEach(sale => {
      if (sale.fullyPaidDate) {
         const msDiff = new Date(sale.fullyPaidDate).getTime() - new Date(sale.date).getTime();
         if (msDiff >= 0) {
            totalPaymentTimeMs += msDiff;
            completedOrdersCount++;
            if (msDiff < fastestPaymentMs) fastestPaymentMs = msDiff;
            if (msDiff > slowestPaymentMs) slowestPaymentMs = msDiff;
         }
      }
    });

    const averagePaymentDays = completedOrdersCount > 0 ? (totalPaymentTimeMs / completedOrdersCount) / (1000 * 60 * 60 * 24) : 0;
    const fastestPaymentDays = fastestPaymentMs === Infinity ? 0 : fastestPaymentMs / (1000 * 60 * 60 * 24);
    const slowestPaymentDays = slowestPaymentMs / (1000 * 60 * 60 * 24);

    // Dynamic Timeframe Metrics
    const totalSalesValue = customer.sales.reduce((sum, s) => sum + Number(s.totalValue), 0);
    const allItems = customer.sales.flatMap(s => s.items);
    const totalTons = allItems.reduce((sum, i) => sum + Number(i.qty), 0);

    // Static All-Time Balance Metrics
    const totalBilledAllTime = customer.ledgers.filter(l => Number(l.amount) > 0).reduce((sum, l) => sum + Number(l.amount), 0);
    const totalPaidAllTime = customer.ledgers.filter(l => Number(l.amount) < 0).reduce((sum, l) => sum + Math.abs(Number(l.amount)), 0);
    const pendingAmount = totalBilledAllTime - totalPaidAllTime;

    const allCompanySales = await prisma.sale.aggregate({
      where: { isDeleted: false, date: { gte: startDate } },
      _sum: { totalValue: true }
    });
    const companyRevenue = Number(allCompanySales._sum.totalValue || 1);
    const revenuePercent = (totalSalesValue / companyRevenue) * 100;

    let rank = "Regular";
    if (revenuePercent > 30) rank = "Platinum (VIP)";
    else if (revenuePercent > 10) rank = "Gold";
    else if (revenuePercent > 2) rank = "Silver";
    if (totalSalesValue === 0) rank = "Inactive";

    // Itemized Janam Kundli Stats
    const categoryStats: Record<string, number> = {};
    const brandStats: Record<string, number> = {};
    const sizeStats: Record<string, number> = {};

    allItems.forEach(item => {
       // Category Volume
       categoryStats[item.productCategory] = (categoryStats[item.productCategory] || 0) + Number(item.qty);

       // Brand Volume
       if (item.brand) {
          brandStats[item.brand] = (brandStats[item.brand] || 0) + Number(item.qty);
       }

       // Size Volume (for manufactured wires)
       if (item.wireType && item.productCategory !== 'Raw Copper Bundle') {
          sizeStats[item.wireType] = (sizeStats[item.wireType] || 0) + Number(item.qty);
       }
    });

    return NextResponse.json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          contact: customer.contact,
          address: customer.address,
          gst: customer.gst,
          transport: customer.transport,
        },
        metrics: {
          totalSalesValue,
          totalTons,
          pendingAmount,
          revenuePercent,
          rank,
          paymentCycle: {
            averageDays: averagePaymentDays,
            fastestDays: fastestPaymentDays,
            slowestDays: slowestPaymentDays,
            completedOrdersCount
          }
        },
        janamKundli: {
          categories: Object.entries(categoryStats).map(([name, value]) => ({ name, value })),
          brands: Object.entries(brandStats).map(([name, value]) => ({ name, value })),
          sizes: Object.entries(sizeStats).map(([name, value]) => ({ name, value }))
        },
        salesHistory: customer.sales.map(s => ({
           id: s.id,
           date: s.date,
           totalValue: Number(s.totalValue),
           amountPaid: Number(s.amountPaid),
           pendingAmount: Math.max(0, Number(s.totalValue) - Number(s.amountPaid)),
           isFullyPaid: Number(s.amountPaid) >= Number(s.totalValue),
           items: s.items
        })),
        paymentHistory: paymentRecords.map(p => ({
           id: p.id,
           date: p.date,
           amount: p.amount,
           description: p.description
        }))
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
