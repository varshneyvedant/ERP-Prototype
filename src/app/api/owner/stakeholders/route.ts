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
    const now = new Date();

    // Customers Ledger Tracking
    const customers = await prisma.customer.findMany({
      include: {
        ledgers: true,
        sales: {
          where: { isDeleted: false },
          include: { items: true },
          orderBy: { date: 'desc' }
        },
        payments: { where: { status: 'APPROVED' } }
      }
    });

    let agingSummary = {
      bucket0_15: 0,
      bucket16_30: 0,
      bucket31_60: 0,
      bucket60Plus: 0,
      totalReceivables: 0
    };

    const enrichedCustomers = customers.map(c => {
      const totalBilledAllTime = c.sales.reduce((sum, s) => sum + Number(s.totalValue), 0);
      const totalPaidAllTime = c.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const pendingAmount = totalBilledAllTime - totalPaidAllTime;

      let customerAging = {
        days0_15: 0,
        days16_30: 0,
        days31_60: 0,
        days60Plus: 0
      };

      const unpaidSales = c.sales.filter(s => Number(s.amountPaid) < Number(s.totalValue));
      let maxOverdueDays = 0;

      unpaidSales.forEach(s => {
        const unpaidAmount = Number(s.totalValue) - Number(s.amountPaid);
        const ageDays = Math.floor((now.getTime() - new Date(s.date).getTime()) / (1000 * 60 * 60 * 24));
        if (ageDays > maxOverdueDays) maxOverdueDays = ageDays;

        if (ageDays <= 15) {
          customerAging.days0_15 += unpaidAmount;
          agingSummary.bucket0_15 += unpaidAmount;
        } else if (ageDays <= 30) {
          customerAging.days16_30 += unpaidAmount;
          agingSummary.bucket16_30 += unpaidAmount;
        } else if (ageDays <= 60) {
          customerAging.days31_60 += unpaidAmount;
          agingSummary.bucket31_60 += unpaidAmount;
        } else {
          customerAging.days60Plus += unpaidAmount;
          agingSummary.bucket60Plus += unpaidAmount;
        }
      });

      if (pendingAmount > 0) {
        agingSummary.totalReceivables += pendingAmount;
      }

      const timeframeSales = c.sales.filter(s => new Date(s.date) >= startDate);
      const totalTonsSold = timeframeSales.reduce((sum, s) => sum + s.items.reduce((itemSum, item) => itemSum + Number(item.qty), 0), 0);
      const totalBilledInTimeframe = timeframeSales.reduce((sum, s) => sum + Number(s.totalValue), 0);

      const creditDays = c.creditDays || 18;
      const isOverdue = maxOverdueDays > creditDays;
      const isLimitExceeded = pendingAmount > Number(c.creditLimit || 7000000);

      return {
        id: c.id,
        name: c.name,
        type: 'Customer',
        contact: c.contact,
        creditLimit: Number(c.creditLimit || 7000000),
        creditDays,
        maxOverdueDays,
        isOverdue,
        isLimitExceeded,
        aging: customerAging,
        totalVolume: totalTonsSold,
        pendingAmount,
        totalBilled: totalBilledInTimeframe
      };
    });

    // Suppliers Ledger Tracking
    const suppliers = await prisma.supplier.findMany({
      include: {
        ledgers: true,
        purchases: {
          where: { isDeleted: false },
          orderBy: { date: 'desc' }
        },
        payments: { where: { status: 'APPROVED' } }
      }
    });

    const enrichedSuppliers = suppliers.map(s => {
      const totalInvoicedAllTime = s.purchases.reduce((sum, p) => sum + Number(p.totalValue), 0);
      const totalPaidAllTime = s.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const pendingAmount = totalInvoicedAllTime - totalPaidAllTime;

      const timeframePurchases = s.purchases.filter(p => new Date(p.date) >= startDate);
      const totalTonsBought = timeframePurchases.reduce((sum, p) => sum + Number(p.qty), 0);
      const totalInvoicedInTimeframe = timeframePurchases.reduce((sum, p) => sum + Number(p.totalValue), 0);

      return {
        id: s.id,
        name: s.name,
        type: 'Supplier',
        contact: s.contact,
        creditLimit: 0,
        creditDays: 0,
        maxOverdueDays: 0,
        isOverdue: false,
        isLimitExceeded: false,
        aging: { days0_15: 0, days16_30: 0, days31_60: 0, days60Plus: 0 },
        totalVolume: totalTonsBought,
        pendingAmount,
        totalBilled: totalInvoicedInTimeframe
      };
    });

    return NextResponse.json({
      success: true,
      agingSummary,
      stakeholders: [...enrichedCustomers, ...enrichedSuppliers]
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
