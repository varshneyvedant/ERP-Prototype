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

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: {
          where: { date: { gte: startDate } },
          orderBy: { date: 'desc' }
        },
        ledgers: true // fetch all for static balance
      }
    });

    if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    const paymentRecords = await prisma.paymentRecord.findMany({
      where: { supplierId: id, type: 'OUTGOING', date: { gte: startDate } },
      orderBy: { date: 'desc' }
    });

    // Payment Cycle Duration Calculation
    let totalPaymentTimeMs = 0;
    let completedOrdersCount = 0;
    let fastestPaymentMs = Infinity;
    let slowestPaymentMs = 0;

    supplier.purchases.forEach(purchase => {
      if (purchase.fullyPaidDate) {
         const msDiff = new Date(purchase.fullyPaidDate).getTime() - new Date(purchase.date).getTime();
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

    // Dynamic Timeframe metrics
    const totalPurchaseValue = supplier.purchases.reduce((sum, p) => sum + Number(p.totalValue), 0);
    const totalTons = supplier.purchases.reduce((sum, p) => sum + Number(p.qty), 0);

    // Static all-time metrics
    const totalInvoicedAllTime = supplier.ledgers.filter(l => Number(l.amount) > 0).reduce((sum, l) => sum + Number(l.amount), 0);
    const totalPaidAllTime = supplier.ledgers.filter(l => Number(l.amount) < 0).reduce((sum, l) => sum + Math.abs(Number(l.amount)), 0);
    const pendingAmount = totalInvoicedAllTime - totalPaidAllTime;

    // To calculate % of stock provided
    const allCompanyPurchases = await prisma.purchase.aggregate({
      where: { isDeleted: false, date: { gte: startDate } },
      _sum: { qty: true }
    });

    const totalCompanyTons = Number(allCompanyPurchases._sum.qty || 1); // avoid div by 0
    const stockPercent = (totalTons / totalCompanyTons) * 100;

    let rank = "Regular";
    if (stockPercent > 40) rank = "Primary Supplier";
    else if (stockPercent > 15) rank = "Secondary Supplier";
    if (totalTons === 0) rank = "Inactive";

    return NextResponse.json({
      success: true,
      data: {
        supplier: {
          id: supplier.id,
          name: supplier.name,
          contact: supplier.contact,
          address: supplier.address,
          gst: supplier.gst,
          bankDetails: supplier.bankDetails,
        },
        metrics: {
          totalPurchaseValue,
          totalTons,
          pendingAmount,
          stockPercent,
          rank,
          paymentCycle: {
            averageDays: averagePaymentDays,
            fastestDays: fastestPaymentDays,
            slowestDays: slowestPaymentDays,
            completedOrdersCount
          }
        },
        purchaseHistory: supplier.purchases.map(p => ({
           id: p.id,
           date: p.date,
           qty: Number(p.qty),
           pricePerTon: p.pricePerTon,
           totalValue: Number(p.totalValue),
           amountPaid: Number(p.amountPaid),
           pendingAmount: Math.max(0, Number(p.totalValue) - Number(p.amountPaid)),
           isFullyPaid: Number(p.amountPaid) >= Number(p.totalValue)
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
