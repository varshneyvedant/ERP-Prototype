import { ManagerProductionPostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';


import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';
import { reconcileFIFOBook } from '@/lib/ledger/reconciliation';
import { checkIdempotency, completeIdempotency } from '@/lib/idempotency';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const productions = await prisma.production.findMany({ where: { isDeleted: false },
      orderBy: { date: 'desc' },
      take: 10
    });
    return NextResponse.json({ productions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
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

  let idempotencyKey: string | null = null;
  try {
    const body = await request.json();
    idempotencyKey = request.headers.get('x-idempotency-key') || body.idempotencyKey || null;

    if (idempotencyKey) {
      const idem = await checkIdempotency(idempotencyKey);
      if (idem) {
        if (idem.status === 'PROCESSING') {
          return NextResponse.json({ error: 'Transaction is already being processed, please wait.' }, { status: 409 });
        }
        return NextResponse.json(idem.response, { status: 200 });
      }
    }

    const validation = ManagerProductionPostSchema.safeParse(body);
    if (!validation.success) {
      const errRes = { error: "Invalid data", details: validation.error.format() };
      if (idempotencyKey) await completeIdempotency(idempotencyKey, 'FAILED', errRes);
      return NextResponse.json(errRes, { status: 400 });
    }
    const { rawCopperUsed, productCategory, brand, wireType, wireProduced, date, estimatedOverhead = 0 } = validation.data;

    const parsedRaw = rawCopperUsed;
    const parsedProduced = wireProduced;

    if (parsedRaw < 0.01 || parsedProduced < 0.01) {
      const errRes = { error: 'it is too small quantity to do this transaction contact your developer' };
      if (idempotencyKey) await completeIdempotency(idempotencyKey, 'FAILED', errRes);
      return NextResponse.json(errRes, { status: 400 });
    }

    if (parsedProduced > parsedRaw) {
      const errRes = { error: 'Finished wire produced cannot be greater than raw copper used.' };
      if (idempotencyKey) await completeIdempotency(idempotencyKey, 'FAILED', errRes);
      return NextResponse.json(errRes, { status: 400 });
    }

    const recordDate = date ? new Date(date) : new Date();
    await assertPeriodNotLocked(recordDate);

    const result = await prisma.$transaction(async (tx) => {
      // Check available stock inside transaction by summing active batches (ensures consistency with green display box)
      const activeBatches = await tx.inventoryBatch.findMany({
          where: { remainingQty: { gt: 0 } }
      });
      const availableStock = activeBatches.reduce((sum, b) => sum + Number(b.remainingQty), 0);

      if (parsedRaw > availableStock) {
          throw new Error(`Not enough raw copper stock. Available: ${availableStock.toFixed(2)} Tons`);
      }

      // Deduct from InventoryBatch (FIFO) and calculate exact cost
      let remainingToDeduct = parsedRaw;

      // Fetch active batches for FIFO deduction (SQLite uses file-level locking via Prisma transaction)
      const batches = await tx.inventoryBatch.findMany({
          where: { remainingQty: { gt: 0 } },
          orderBy: { date: 'asc' }
      });

      let totalRawCost = 0;

      for (const batch of batches) {
          if (remainingToDeduct <= 0) break;
          const availableInBatch = Number(batch.remainingQty);
          const deductAmount = Math.min(availableInBatch, remainingToDeduct);
          
          totalRawCost += deductAmount * Number(batch.pricePerTon);

          await tx.inventoryBatch.update({
              where: { id: batch.id },
              data: { remainingQty: Math.max(0, availableInBatch - deductAmount) }
          });
          remainingToDeduct -= deductAmount;
      }

      // Cost per ton of finished wire = Total Raw Cost / Wire Produced (factors in scrap loss)
      const costPerTonFinished = parsedProduced > 0 ? ((totalRawCost + Number(estimatedOverhead)) / parsedProduced) : 0;

      const production = await tx.production.create({
        data: {
          date: recordDate,
          rawCopperUsed: parsedRaw,
          productCategory,
          brand: brand || null,
          wireType: wireType || '',
          wireProduced: parsedProduced,
          estimatedOverhead: Number(estimatedOverhead),
          scrapGenerated: parsedRaw - parsedProduced,
          finishedGoodsBatch: {
             create: {
                date: recordDate,
                productCategory,
                brand: brand || null,
                wireType: wireType || '',
                initialQty: parsedProduced,
                remainingQty: parsedProduced,
                costPerTon: costPerTonFinished
             }
          }
        }
      });

      await tx.scrapInventory.create({
         data: {
            date: recordDate,
            type: 'GENERATED',
            qty: parsedRaw - parsedProduced
         }
      });

      // Post Double-Entry Journal Entry
      await postJournalEntry(tx, {
        date: recordDate,
        description: `Production Run: Produced ${parsedProduced}T ${productCategory} from ${parsedRaw}T Raw Copper (ID: ${production.id})`,
        referenceType: 'PRODUCTION' as any,
        referenceId: production.id,
        lines: [
          { accountName: 'Inventory - Finished Goods', accountType: 'ASSET' as const, debit: totalRawCost, credit: 0 },
          { accountName: 'Inventory - Raw Materials', accountType: 'ASSET' as const, debit: 0, credit: totalRawCost }
        ]
      });

      return production;
    }, { maxWait: 10000, timeout: 30000 });

    await logAudit({
      action: 'CREATE',
      module: 'Production',
      description: `Logged production of ${parsedProduced}T ${productCategory}`,
      details: { id: result.id, rawCopperUsed, wireProduced, productCategory, brand, wireType }
    });

    const successResponse = { success: true, production: result };
    if (idempotencyKey) {
      await completeIdempotency(idempotencyKey, 'SUCCESS', successResponse);
    }
    return NextResponse.json(successResponse);
  } catch (error: any) {
    console.error(error);
    const errResponse = { error: error.message || 'Database transaction failed' };
    if (idempotencyKey) {
      await completeIdempotency(idempotencyKey, 'FAILED', errResponse);
    }
    return NextResponse.json(errResponse, { status: 500 });
  }
}
