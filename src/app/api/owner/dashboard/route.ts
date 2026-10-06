import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startOfDay, endOfDay, subDays } from 'date-fns';



export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role?.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const today = new Date();
    const startOfToday = startOfDay(today);
    const endOfToday = endOfDay(today);
    const startOf30Days = startOfDay(subDays(today, 30));

    // 1. Core Financial Status (Static aggregates)
    const allCustomerLedgers = await prisma.customerLedger.aggregate({ where: { isDeleted: false },  _sum: { amount: true } });
    const totalReceivables = allCustomerLedgers._sum.amount || 0;

    const allSupplierLedgers = await prisma.supplierLedger.aggregate({ where: { isDeleted: false },  _sum: { amount: true } });
    const totalPayables = allSupplierLedgers._sum.amount || 0;
    const netAmount = Number(totalReceivables) - Number(totalPayables);

    // Cash In Hand Calculation:
    const tempCashInHandIn = await prisma.paymentRecord.aggregate({ where: { type: 'INCOMING', status: 'APPROVED' }, _sum: { amount: true } });
    const tempCashInHandOut = await prisma.paymentRecord.aggregate({ where: { type: 'OUTGOING', status: 'APPROVED' }, _sum: { amount: true } });
    const tempExpenses = await prisma.expense.aggregate({ where: { isDeleted: false, status: 'PAID' },  _sum: { amount: true } });
    const tempAdvances = await prisma.advance.aggregate({ _sum: { amount: true } });
    const tempRepayments = await prisma.advanceRepayment.aggregate({ _sum: { amount: true } });

    const totalCashIn = Number(tempCashInHandIn._sum.amount || 0) + Number(tempRepayments._sum.amount || 0);
    const totalCashOut = Number(tempCashInHandOut._sum.amount || 0) + Number(tempExpenses._sum.amount || 0) + Number(tempAdvances._sum.amount || 0);
    const cashInHand = totalCashIn - totalCashOut;

    // 2. Factory Operational Status
    const totalPurchasedObj = await prisma.purchase.aggregate({ where: { isDeleted: false },  _sum: { qty: true } });
    const totalProducedObj = await prisma.production.aggregate({ where: { isDeleted: false },  _sum: { rawCopperUsed: true } });
    const totalSoldRawObj = await prisma.saleItem.aggregate({ where: { sale: { isDeleted: false }, productCategory: 'Raw Copper Bundle' }, _sum: { qty: true }});
    const rawCopperStock = Number(totalPurchasedObj._sum.qty || 0) - (Number(totalProducedObj._sum.rawCopperUsed || 0) + Number(totalSoldRawObj._sum.qty || 0));

    // Production output today
    const productionToday = await prisma.production.aggregate({
      where: { isDeleted: false, date: { gte: startOfToday, lte: endOfToday } },
      _sum: { wireProduced: true }
    });

    // Yield ratio (Last 30 Days)
    const totalProd30Days = await prisma.production.aggregate({
      where: { isDeleted: false, date: { gte: startOf30Days, lte: endOfToday } },
      _sum: { rawCopperUsed: true, wireProduced: true }
    });
    const yieldPercent = totalProd30Days._sum.rawCopperUsed
      ? (Number(totalProd30Days._sum.wireProduced || 0) / Number(totalProd30Days._sum.rawCopperUsed)) * 100
      : 0;

    // 3. System Audits (Last 5 logs)
    const recentAudits = await prisma.auditLog.findMany({
      orderBy: { date: 'desc' },
      take: 5
    });

    // 5. Finished Goods Low Stock Alerts (< 0.50 Tons / 500 Kg)
    const batches = await prisma.finishedGoodsBatch.findMany({
      where: { remainingQty: { gt: 0 } },
      select: { productCategory: true, brand: true, wireType: true, remainingQty: true }
    });

    const stockMap: Record<string, { productCategory: string; brand: string; wireType: string; totalStock: number }> = {};
    batches.forEach(b => {
      const key = `${b.productCategory}_${b.brand || 'Unbranded'}_${b.wireType}`;
      if (!stockMap[key]) {
        stockMap[key] = {
          productCategory: b.productCategory,
          brand: b.brand || 'Unbranded',
          wireType: b.wireType,
          totalStock: 0
        };
      }
      stockMap[key].totalStock += Number(b.remainingQty);
    });

    const lowFinishedGoodsAlerts = Object.values(stockMap).filter(item => item.totalStock < 0.50);

    // 6. Pending Payment Authorizations (Dual-Auth)
    const pendingPayments = await prisma.paymentRecord.findMany({
      where: { status: 'PENDING' },
      include: { customer: true, supplier: true },
      orderBy: { date: 'desc' }
    });

    return NextResponse.json({
      success: true,
      data: {
        financials: {
          totalReceivables,
          totalPayables,
          netAmount,
          cashInHand
        },
        operations: {
          rawCopperStock,
          isRawCopperLow: rawCopperStock < 5.00,
          lowFinishedGoodsAlerts,
          productionToday: Number(productionToday._sum.wireProduced || 0),
          yield30Days: yieldPercent
        },
        recentAudits,
        pendingPayments
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
