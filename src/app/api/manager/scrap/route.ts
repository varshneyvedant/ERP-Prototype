import { OwnerScrapPostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';
import { logAudit } from '@/lib/audit/logger';
import { postJournalEntry } from '@/lib/ledger/journal';

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

    const result = await prisma.$transaction(async (tx) => {
      const allScrap = await tx.scrapInventory.findMany({ where: { isDeleted: false } });
      let currentHolding = 0;
      allScrap.forEach(s => {
         if (s.type === "GENERATED") currentHolding += Number(s.qty);
         if (s.type === "SOLD" || s.type === "PROCESS_LOSS_ADJUSTMENT") currentHolding -= Number(s.qty);
      });
      
      if (parsedQty > currentHolding + 0.001) {
         throw new Error(`Cannot record ${parsedQty}T of scrap. Only ${currentHolding.toFixed(2)}T available in system.`);
      }

      if (type === "PROCESS_LOSS_ADJUSTMENT") {
        const lossRecord = await tx.scrapInventory.create({
          data: {
            type: "PROCESS_LOSS_ADJUSTMENT",
            qty: parsedQty,
            revenue: 0,
            notes: notes || "Chemical & Process Burning Loss write-off"
          }
        });
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

      // If user also specified a chemical loss adjustment gap in the sale form
      if (body.chemicalLossQty && Number(body.chemicalLossQty) > 0) {
        const chemQty = Number(body.chemicalLossQty);
        await tx.scrapInventory.create({
          data: {
            type: "PROCESS_LOSS_ADJUSTMENT",
            qty: chemQty,
            revenue: 0,
            notes: `Process / Chemical loss identified during scrap sale of ${parsedQty}T`
          }
        });
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

      await postJournalEntry(tx, {
        date: recordDate,
        description: `Scrap Sale: ${parsedQty}T at ₹${parsedRev}`,
        referenceType: 'SCRAP_SALE' as any,
        referenceId: scrapSale.id,
        lines: [
          { accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: parsedRev, credit: 0 },
          { accountName: 'Scrap Revenue', accountType: 'REVENUE' as const, debit: 0, credit: parsedRev }
        ]
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
