import { getServerSession, authOptions } from '@/lib/mock-session';
import { OwnerScrapPostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';


import { prisma } from '@/lib/prisma';
import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';
import { logAudit } from '@/lib/audit/logger';
import { postJournalEntry } from '@/lib/ledger/journal';
import { assertPeriodNotLocked } from '@/lib/periodLock';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const timeframe = (searchParams.get('timeframe') as Timeframe) || '1M';
    const startDate = getStartDateFromTimeframe(timeframe);

    // Get current total holding of scrap (All-Time)
    const allScrap = await prisma.scrapInventory.findMany({ where: { isDeleted: false } });
    let currentHolding = 0;
    allScrap.forEach(s => {
       if (s.type === "GENERATED") currentHolding += Number(s.qty);
       if (s.type === "SOLD" || s.type === "PROCESS_LOSS_ADJUSTMENT") currentHolding -= Number(s.qty);
    });

    // Get timeframe specific data
    const timeframeScrap = await prisma.scrapInventory.findMany({
       where: { isDeleted: false, date: { gte: startDate } },
       orderBy: { date: 'desc' }
    });

    let generatedInTimeframe = 0;
    let soldInTimeframe = 0;
    let revenueInTimeframe = 0;
    let processLossInTimeframe = 0;

    const history = timeframeScrap.map(s => {
       if (s.type === "GENERATED") generatedInTimeframe += Number(s.qty);
       if (s.type === "SOLD") {
          soldInTimeframe += Number(s.qty);
          revenueInTimeframe += Number(s.revenue);
       }
       if (s.type === "PROCESS_LOSS_ADJUSTMENT") {
          processLossInTimeframe += Number(s.qty);
       }
       return {
          id: s.id,
          date: s.date,
          type: s.type,
          qty: s.qty,
          revenue: s.revenue,
          notes: s.notes
       };
    });

    return NextResponse.json({
      success: true,
      data: {
        currentHolding: Math.max(0, currentHolding),
        generatedInTimeframe,
        soldInTimeframe,
        revenueInTimeframe,
        processLossInTimeframe,
        history
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = OwnerScrapPostSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { type, qty, revenue, notes, date } = validation.data;

    const parsedQty = qty;
    const parsedRev = revenue || 0;
    const recordDate = date ? new Date(date) : new Date();
    await assertPeriodNotLocked(recordDate);

    const chemQty = body.chemicalLossQty && Number(body.chemicalLossQty) > 0 ? Number(body.chemicalLossQty) : 0;

    const result = await prisma.$transaction(async (tx) => {
      const allScrap = await tx.scrapInventory.findMany({ where: { isDeleted: false } });
      let currentHolding = 0;
      allScrap.forEach(s => {
         if (s.type === "GENERATED") currentHolding += Number(s.qty);
         if (s.type === "SOLD" || s.type === "PROCESS_LOSS_ADJUSTMENT") currentHolding -= Number(s.qty);
      });

      const totalOut = parsedQty + (type === "PROCESS_LOSS_ADJUSTMENT" ? 0 : chemQty);
      if (totalOut > currentHolding + 0.001) {
         throw new Error(`Cannot record ${totalOut}T of scrap. Only ${currentHolding.toFixed(2)}T available in system.`);
      }

      // Book value of scrap asset in the GL -> weighted-average cost per ton to relieve
      const scrapAgg = await tx.journalLine.aggregate({
        where: { accountName: 'Inventory - Scrap' },
        _sum: { debit: true, credit: true }
      });
      const scrapBookValue = Number(scrapAgg._sum.debit || 0) - Number(scrapAgg._sum.credit || 0);
      const costPerScrapTon = currentHolding > 0.001 && scrapBookValue > 0 ? scrapBookValue / currentHolding : 0;
      const round2 = (n: number) => Math.round(n * 100) / 100;

      if (type === "PROCESS_LOSS_ADJUSTMENT") {
        const lossRecord = await tx.scrapInventory.create({
          data: {
            type: "PROCESS_LOSS_ADJUSTMENT",
            qty: parsedQty,
            revenue: 0,
            notes: notes || "Chemical & Process Burning Loss write-off"
          }
        });
        const lossValue = round2(parsedQty * costPerScrapTon);
        if (lossValue > 0) {
          await postJournalEntry(tx, {
            date: recordDate,
            description: `Scrap process-loss write-off: ${parsedQty}T`,
            referenceType: 'SCRAP_SALE' as any,
            referenceId: lossRecord.id,
            lines: [
              { accountName: 'Process Loss Expense', accountType: 'EXPENSE', debit: lossValue, credit: 0 },
              { accountName: 'Inventory - Scrap', accountType: 'ASSET', debit: 0, credit: lossValue }
            ]
          });
        }
        return lossRecord;
      }

      // Standard Scrap Sale
      const scrapSale = await tx.scrapInventory.create({
        data: {
          type: "SOLD",
          qty: parsedQty,
          revenue: parsedRev,
          notes: notes || null
        }
      });

      let chemLossValue = 0;
      if (chemQty > 0) {
        const chemRecord = await tx.scrapInventory.create({
          data: {
            type: "PROCESS_LOSS_ADJUSTMENT",
            qty: chemQty,
            revenue: 0,
            notes: `Process / Chemical loss identified during scrap sale of ${parsedQty}T`
          }
        });
        chemLossValue = round2(chemQty * costPerScrapTon);
      }

      await tx.paymentRecord.create({
        data: {
           date: recordDate,
           amount: parsedRev,
           type: 'INCOMING',
           scrapSaleId: scrapSale.id,
           description: `Sale of Scrap Copper (${parsedQty} Tons)`
        }
      });

      const costRelieved = round2(parsedQty * costPerScrapTon);
      const saleLines: { accountName: string; accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'; debit: number; credit: number; }[] = [
        { accountName: 'Cash & Bank', accountType: 'ASSET', debit: parsedRev, credit: 0 },
        { accountName: 'Scrap Revenue', accountType: 'REVENUE', debit: 0, credit: parsedRev }
      ];
      if (costRelieved > 0) {
        saleLines.push(
          { accountName: 'Cost of Scrap Sold', accountType: 'EXPENSE', debit: costRelieved, credit: 0 },
          { accountName: 'Inventory - Scrap', accountType: 'ASSET', debit: 0, credit: costRelieved }
        );
      }
      if (chemLossValue > 0) {
        saleLines.push(
          { accountName: 'Process Loss Expense', accountType: 'EXPENSE', debit: chemLossValue, credit: 0 },
          { accountName: 'Inventory - Scrap', accountType: 'ASSET', debit: 0, credit: chemLossValue }
        );
      }

      await postJournalEntry(tx, {
        date: recordDate,
        description: `Scrap Sale: ${parsedQty}T at ₹${parsedRev}`,
        referenceType: 'SCRAP_SALE' as any,
        referenceId: scrapSale.id,
        lines: saleLines
      });

      return scrapSale;
    });

    await logAudit({
      action: 'CREATE',
      module: 'Scrap',
      description: `Logged scrap copper sale of ${parsedQty} Tons for ₹${parsedRev}`,
      details: { id: result.id, qty: parsedQty, revenue: parsedRev }
    });

    return NextResponse.json({ success: true, scrapSale: result });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
