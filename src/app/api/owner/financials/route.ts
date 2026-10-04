export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { format, eachDayOfInterval, eachMonthOfInterval, eachYearOfInterval } from 'date-fns';
import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';

const N = (v: any) => Number(v ?? 0);

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'owner' && role !== 'accountant') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const timeframe = (searchParams.get('timeframe') as Timeframe) || '1M';
    const startDate = getStartDateFromTimeframe(timeframe);
    const endDate = new Date();

    // Chart granularity
    let formatStr = 'yyyy';
    let keyFmt = 'yyyy';
    let intervalsFn: (start: Date) => Date[];
    if (['1W', '1M'].includes(timeframe)) {
      formatStr = 'dd MMM'; keyFmt = 'yyyy-MM-dd';
      intervalsFn = (s) => eachDayOfInterval({ start: s, end: endDate });
    } else if (['3M', '6M', '1Y', 'FY'].includes(timeframe)) {
      formatStr = 'MMM yyyy'; keyFmt = 'yyyy-MM';
      intervalsFn = (s) => eachMonthOfInterval({ start: s, end: endDate });
    } else {
      formatStr = 'yyyy'; keyFmt = 'yyyy';
      intervalsFn = (s) => eachYearOfInterval({ start: s, end: endDate });
    }

    let chartStart = startDate;
    if (timeframe === 'ALL') {
      const firstSale = await prisma.sale.findFirst({ orderBy: { date: 'asc' }, select: { date: true } });
      chartStart = firstSale ? firstSale.date : new Date(new Date().getFullYear() - 3, 0, 1);
    }
    const intervals = intervalsFn(chartStart);
    const rangeWhere = { gte: chartStart < startDate ? chartStart : startDate, lte: endDate };

    // ---- ALL independent queries in parallel (was ~25 sequential round-trips to Neon) ----
    const [
      expensesByCat, custLedgerAgg, suppLedgerAgg,
      cashIn, cashOut, paidExpenses, advancesAgg, repaymentsAgg,
      prodAgg, salesRaw, expRaw, marketPricesRaw, scrapSalesRaw,
      paidSales, paidPurchases,
      purchasedAgg, producedAgg, soldRawAgg,
      scrapStats, lastScrapSales,
      plLines, bsLines
    ] = await Promise.all([
      prisma.expense.groupBy({ by: ['category'], where: { isDeleted: false, date: { gte: startDate, lte: endDate } }, _sum: { amount: true } }),
      prisma.customerLedger.aggregate({ where: { isDeleted: false }, _sum: { amount: true } }),
      prisma.supplierLedger.aggregate({ where: { isDeleted: false }, _sum: { amount: true } }),
      prisma.paymentRecord.aggregate({ where: { type: 'INCOMING', status: 'APPROVED' }, _sum: { amount: true } }),
      prisma.paymentRecord.aggregate({ where: { type: 'OUTGOING', status: 'APPROVED' }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { isDeleted: false, status: 'PAID' }, _sum: { amount: true } }),
      prisma.advance.aggregate({ _sum: { amount: true } }),
      prisma.advanceRepayment.aggregate({ _sum: { amount: true } }),
      prisma.production.aggregate({
        where: { isDeleted: false, date: { gte: startDate, lte: endDate } },
        _sum: { rawCopperUsed: true, wireProduced: true }
      }),
      prisma.sale.findMany({
        where: { isDeleted: false, date: rangeWhere },
        select: { date: true, totalValue: true, items: { select: { qty: true, rawCopperCostAtSale: true } } }
      }),
      prisma.expense.findMany({ where: { isDeleted: false, date: rangeWhere }, select: { date: true, amount: true } }),
      prisma.marketPrice.findMany({ where: { date: rangeWhere }, select: { date: true, price: true } }),
      prisma.scrapInventory.findMany({ where: { isDeleted: false, type: 'SOLD', date: rangeWhere }, select: { date: true, revenue: true } }),
      prisma.sale.findMany({ where: { isDeleted: false, fullyPaidDate: { not: null } }, select: { date: true, fullyPaidDate: true } }),
      prisma.purchase.findMany({ where: { isDeleted: false, fullyPaidDate: { not: null } }, select: { date: true, fullyPaidDate: true } }),
      prisma.purchase.aggregate({ where: { isDeleted: false }, _sum: { qty: true } }),
      prisma.production.aggregate({ where: { isDeleted: false }, _sum: { rawCopperUsed: true } }),
      prisma.saleItem.aggregate({ where: { sale: { isDeleted: false }, productCategory: 'Raw Copper Bundle' }, _sum: { qty: true } }),
      prisma.production.aggregate({ where: { isDeleted: false }, _sum: { rawCopperUsed: true, scrapGenerated: true } }),
      prisma.scrapInventory.findMany({ where: { isDeleted: false, type: 'SOLD' }, take: 5, orderBy: { date: 'desc' } }),
      prisma.journalLine.groupBy({
        by: ['accountName', 'accountType'],
        where: { journalEntry: { date: { gte: startDate, lte: endDate } } },
        _sum: { debit: true, credit: true }
      }),
      prisma.journalLine.groupBy({
        by: ['accountName', 'accountType'],
        where: { journalEntry: { date: { lte: endDate } } },
        _sum: { debit: true, credit: true }
      })
    ]);

    const expenseData = expensesByCat.map(e => ({ name: e.category, value: N(e._sum.amount) }));

    // Global positions
    const totalReceivables = N(custLedgerAgg._sum.amount);
    const totalPayables = N(suppLedgerAgg._sum.amount);
    const netAmount = totalReceivables - totalPayables;

    const totalCashIn = N(cashIn._sum.amount) + N(repaymentsAgg._sum.amount);
    const totalCashOut = N(cashOut._sum.amount) + N(paidExpenses._sum.amount) + N(advancesAgg._sum.amount);
    const cashInHand = totalCashIn - totalCashOut;

    const yieldPercent = prodAgg._sum.rawCopperUsed
      ? (N(prodAgg._sum.wireProduced) / N(prodAgg._sum.rawCopperUsed)) * 100
      : 0;

    // ---- Chart: O(N) bucketing instead of O(intervals x rows) filtering ----
    const keyOf = (d: Date) => format(d, keyFmt);
    type Bucket = { rev: number; scrapRev: number; cogs: number; exp: number; priceSum: number; priceCnt: number };
    const buckets = new Map<string, Bucket>();
    const bucket = (k: string): Bucket => {
      let b = buckets.get(k);
      if (!b) { b = { rev: 0, scrapRev: 0, cogs: 0, exp: 0, priceSum: 0, priceCnt: 0 }; buckets.set(k, b); }
      return b;
    };
    let timeframeTons = 0;
    for (const s of salesRaw) {
      const b = bucket(keyOf(s.date));
      b.rev += N(s.totalValue);
      for (const it of s.items) {
        b.cogs += N(it.qty) * N(it.rawCopperCostAtSale);
        timeframeTons += N(it.qty);
      }
    }
    for (const s of scrapSalesRaw) bucket(keyOf(s.date)).scrapRev += N(s.revenue);
    for (const e of expRaw) bucket(keyOf(e.date)).exp += N(e.amount);
    for (const p of marketPricesRaw) { const b = bucket(keyOf(p.date)); b.priceSum += N(p.price); b.priceCnt += 1; }

    const dynamicData = intervals.map(d => {
      const b = buckets.get(keyOf(d));
      const revenue = b ? b.rev + b.scrapRev : 0;
      const gross = b ? revenue - b.cogs : 0;
      const exp = b ? b.exp : 0;
      return {
        period: format(d, formatStr),
        Revenue: revenue,
        Expenses: exp,
        GrossProfit: gross,
        NetProfit: gross - exp,
        CopperPrice: b && b.priceCnt > 0 ? b.priceSum / b.priceCnt : 0
      };
    });

    const totalTimeframeRevenue = dynamicData.reduce((a, c) => a + c.Revenue, 0);
    const totalTimeframeGross = dynamicData.reduce((a, c) => a + c.GrossProfit, 0);
    const pureExpenses = expRaw.reduce((s, x) => s + N(x.amount), 0);
    const totalTimeframeNet = totalTimeframeGross - pureExpenses;
    const avgProfitPerTon = timeframeTons > 0 ? totalTimeframeNet / timeframeTons : 0;

    // Payment analytics
    const dayMs = 1000 * 60 * 60 * 24;
    const waitStats = (rows: { date: Date; fullyPaidDate: Date | null }[]) => {
      let total = 0, slowest = 0;
      for (const r of rows) {
        const w = new Date(r.fullyPaidDate!).getTime() - new Date(r.date).getTime();
        total += w;
        if (w / dayMs > slowest) slowest = w / dayMs;
      }
      return { avgDays: rows.length ? total / rows.length / dayMs : 0, slowestDays: slowest, completedOrders: rows.length };
    };

    // Inventory optimisation
    const rawCopperStock = N(purchasedAgg._sum.qty) - (N(producedAgg._sum.rawCopperUsed) + N(soldRawAgg._sum.qty));
    const diffDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / dayMs));
    const avgDailyConsumption = N(prodAgg._sum.rawCopperUsed) / diffDays;
    const daysRemaining = avgDailyConsumption > 0 ? rawCopperStock / avgDailyConsumption : 999;

    let reorderUrgency = 'NORMAL';
    let recommendedReorderQty = 0;
    if (daysRemaining < 5) {
      reorderUrgency = 'CRITICAL';
      recommendedReorderQty = Math.max(15, avgDailyConsumption * 15);
    } else if (daysRemaining < 10) {
      reorderUrgency = 'WARNING';
      recommendedReorderQty = Math.max(10, avgDailyConsumption * 10);
    }

    const scrapRatio = scrapStats._sum.rawCopperUsed
      ? N(scrapStats._sum.scrapGenerated) / N(scrapStats._sum.rawCopperUsed)
      : 0.05;
    const predictedScrapTons = rawCopperStock * scrapRatio;
    const lastScrapQty = lastScrapSales.reduce((s, x) => s + N(x.qty), 0);
    const avgScrapPrice = lastScrapSales.length > 0 && lastScrapQty > 0
      ? lastScrapSales.reduce((s, x) => s + N(x.revenue), 0) / lastScrapQty
      : 450000;
    const predictedScrapValue = predictedScrapTons * avgScrapPrice;

    // ---- P&L from the journal (all P&L accounts, incl. salary / scrap / process loss) ----
    const net = (l: { _sum: { debit: any; credit: any } }) => N(l._sum.debit) - N(l._sum.credit); // debit-positive
    const plBy = (name: string) => {
      const l = plLines.find(x => x.accountName === name);
      return l ? net(l) : 0;
    };
    const plSalesRevenue = -plBy('Sales Revenue');
    const plScrapRevenue = -(plBy('Scrap Sales') + plBy('Scrap Revenue'));
    const plTotalRevenue = plSalesRevenue + plScrapRevenue;
    const plCogs = plBy('Cost of Goods Sold') + plBy('Cost of Scrap Sold');
    const plGrossProfit = plTotalRevenue - plCogs;
    // Overhead Absorbed is a contra-expense (credit) - it moves cost into inventory
    const plOpex =
      plBy('Factory Expenses') + plBy('Salary Expense') + plBy('Process Loss Expense') + plBy('Manufacturing Overhead Absorbed');
    const plNetProfit = plGrossProfit - plOpex;

    // ---- Balance sheet: roll up ALL inventory sub-accounts ----
    const bsAssetBy = (match: (n: string) => boolean) =>
      bsLines.filter(l => match(l.accountName)).reduce((s, l) => s + net(l), 0);
    const bsCashBank = bsAssetBy(n => n === 'Cash & Bank');
    const bsAR = bsAssetBy(n => n === 'Accounts Receivable');
    const bsInventory = bsAssetBy(n => n === 'Inventory' || n.startsWith('Inventory - '));
    const bsAdvances = bsAssetBy(n => n === 'Employee Advances');
    const bsTotalAssets = bsCashBank + bsAR + bsInventory + bsAdvances;
    const bsAP = -bsAssetBy(n => n === 'Accounts Payable');
    const bsTotalLiabilities = bsAP;
    const bsEquity = bsTotalAssets - bsTotalLiabilities;

    return NextResponse.json({
      success: true,
      data: {
        financialStatements: {
          pl: {
            salesRevenue: plSalesRevenue,
            scrapRevenue: plScrapRevenue,
            totalRevenue: plTotalRevenue,
            cogs: plCogs,
            grossProfit: plGrossProfit,
            operatingExpenses: plOpex,
            netProfit: plNetProfit
          },
          bs: {
            cashBank: bsCashBank,
            accountsReceivable: bsAR,
            inventory: bsInventory,
            employeeAdvances: bsAdvances,
            totalAssets: bsTotalAssets,
            accountsPayable: bsAP,
            totalLiabilities: bsTotalLiabilities,
            retainedEarnings: bsEquity
          }
        },
        expenseBreakdown: expenseData,
        monthlyTrends: dynamicData,
        overallYield: yieldPercent,
        netAmount,
        totalReceivables,
        totalPayables,
        cashInHand,
        timeframe,
        inventoryOptimization: {
          rawCopperStock,
          daysRemaining: daysRemaining > 900 ? '99+' : Number(daysRemaining).toFixed(1),
          reorderUrgency,
          recommendedReorderQty: Number(recommendedReorderQty).toFixed(1),
          predictedScrapTons: Number(predictedScrapTons).toFixed(2),
          predictedScrapValue: Number(predictedScrapValue)
        },
        paymentAnalytics: {
          customers: waitStats(paidSales),
          suppliers: waitStats(paidPurchases)
        },
        metrics: {
          totalRevenue: totalTimeframeRevenue,
          totalGrossProfit: totalTimeframeGross,
          totalNetProfit: totalTimeframeNet,
          totalExpenses: pureExpenses,
          avgProfitPerTon
        }
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
