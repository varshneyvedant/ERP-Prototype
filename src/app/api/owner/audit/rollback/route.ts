import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';


import { logAudit } from '@/lib/audit/logger';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';

/**
 * Posts a mirror-image (debit<->credit swapped) journal entry for every entry
 * referencing the record. History is preserved - nothing is deleted.
 */
async function reverseJournals(
  tx: Prisma.TransactionClient,
  referenceType: string,
  referenceId: string,
  label: string
) {
  const entries = await tx.journalEntry.findMany({
    where: { referenceType, referenceId },
    include: { lines: true }
  });
  for (const entry of entries) {
    // Skip entries that are themselves reversals
    if (entry.description.startsWith('REVERSAL')) continue;
    await postJournalEntry(tx, {
      date: new Date(),
      description: `REVERSAL (${label}): ${entry.description}`,
      referenceType: referenceType as any,
      referenceId: `${referenceId}:REV`,
      lines: entry.lines.map(l => ({
        accountName: l.accountName,
        accountType: l.accountType as any,
        debit: Number(l.credit),
        credit: Number(l.debit)
      }))
    });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role?.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { logId } = await request.json();
    if (!logId) return NextResponse.json({ error: 'Missing Log ID' }, { status: 400 });

    const auditLog = await prisma.auditLog.findUnique({ where: { id: logId } });
    if (!auditLog) return NextResponse.json({ error: 'Audit log not found' }, { status: 404 });

    if (auditLog.action !== 'CREATE') {
      return NextResponse.json({ error: 'Only CREATE actions can be rolled back automatically' }, { status: 400 });
    }

    const details = auditLog.details ? JSON.parse(auditLog.details) : {};
    const targetId = details.id;

    if (!targetId) {
      return NextResponse.json({ error: 'Target ID not found in log details. Cannot rollback historical logs without IDs.' }, { status: 400 });
    }

    const module = auditLog.module;
    const label = `Log ${logId}`;

    await prisma.$transaction(async (tx) => {
      if (module === 'Sales') {
        const sale = await tx.sale.findUnique({ where: { id: targetId }, include: { items: true } });
        if (!sale) throw new Error('Sale not found');
        if (sale.isDeleted) throw new Error('This sale has already been rolled back.');
        await assertPeriodNotLocked(sale.date);
        if (Number(sale.amountPaid) > 0) {
          throw new Error('This invoice has payments applied. Reverse the payment(s) first, then roll back the sale.');
        }

        // Give stock back (approximation: returns to the most recent matching batch - FIFO layer links are not stored per sale)
        for (const item of sale.items) {
          if (item.productCategory === 'Raw Copper Bundle') {
            const batch = await tx.inventoryBatch.findFirst({ orderBy: { date: 'desc' } });
            if (batch) await tx.inventoryBatch.update({ where: { id: batch.id }, data: { remainingQty: { increment: item.qty } } });
          } else {
            const batch = await tx.finishedGoodsBatch.findFirst({
              where: { productCategory: item.productCategory, brand: item.brand, wireType: item.wireType || '' },
              orderBy: { date: 'desc' }
            });
            if (batch) await tx.finishedGoodsBatch.update({ where: { id: batch.id }, data: { remainingQty: { increment: item.qty } } });
          }
          if (item.saudaContractId) {
            await tx.saudaContract.update({
              where: { id: item.saudaContractId },
              data: { remainingQty: { increment: item.qty }, status: 'ACTIVE' }
            });
          }
        }

        await tx.customerLedger.updateMany({
          where: { description: { startsWith: `Invoice Sale ID: ${targetId}` } },
          data: { isDeleted: true }
        });
        await tx.sale.update({ where: { id: targetId }, data: { isDeleted: true } });
        await reverseJournals(tx, 'SALE', targetId, label);

      } else if (module === 'Purchases') {
        const purchase = await tx.purchase.findUnique({ where: { id: targetId }, include: { inventoryBatch: true } });
        if (!purchase) throw new Error('Purchase not found');
        if (purchase.isDeleted) throw new Error('This purchase has already been rolled back.');
        await assertPeriodNotLocked(purchase.date);
        if (Number(purchase.amountPaid) > 0) {
          throw new Error('This bill has payments applied. Reverse the payment(s) first, then roll back the purchase.');
        }
        const batch = purchase.inventoryBatch;
        if (batch && Number(batch.remainingQty) + 0.001 < Number(batch.initialQty)) {
          throw new Error('Part of this copper has already been used/sold - cannot roll back the purchase. Issue a Debit Note for the unused portion instead.');
        }

        const ledger = await tx.supplierLedger.findFirst({
          where: { supplierId: purchase.supplierId, amount: purchase.totalValue, date: purchase.date, isDeleted: false }
        });
        if (ledger) await tx.supplierLedger.update({ where: { id: ledger.id }, data: { isDeleted: true } });
        if (batch) await tx.inventoryBatch.update({ where: { id: batch.id }, data: { remainingQty: 0 } });
        await tx.purchase.update({ where: { id: targetId }, data: { isDeleted: true } });
        await reverseJournals(tx, 'PURCHASE', targetId, label);

      } else if (module === 'Production') {
        const production = await tx.production.findUnique({ where: { id: targetId }, include: { finishedGoodsBatch: true } });
        if (!production) throw new Error('Production record not found');
        if (production.isDeleted) throw new Error('This production run has already been rolled back.');
        await assertPeriodNotLocked(production.date);
        const fg = production.finishedGoodsBatch;
        if (fg && Number(fg.remainingQty) + 0.001 < Number(fg.initialQty)) {
          throw new Error('Some of this finished wire has already been sold - cannot roll back the production run. Use a Credit Note flow or adjust manually.');
        }

        // Return raw copper (approximation: to the most recent raw batch)
        const rawBatch = await tx.inventoryBatch.findFirst({ orderBy: { date: 'desc' } });
        if (rawBatch) await tx.inventoryBatch.update({ where: { id: rawBatch.id }, data: { remainingQty: { increment: production.rawCopperUsed } } });
        if (fg) await tx.finishedGoodsBatch.update({ where: { id: fg.id }, data: { remainingQty: 0 } });

        const scrapRow = await tx.scrapInventory.findFirst({
          where: { type: 'GENERATED', qty: production.scrapGenerated, date: production.date, isDeleted: false }
        });
        if (scrapRow) await tx.scrapInventory.update({ where: { id: scrapRow.id }, data: { isDeleted: true } });

        await tx.production.update({ where: { id: targetId }, data: { isDeleted: true } });
        await reverseJournals(tx, 'PRODUCTION', targetId, label);

      } else if (module === 'Expense') {
        const expense = await tx.expense.findUnique({ where: { id: targetId } });
        if (!expense) throw new Error('Expense not found');
        if (expense.isDeleted) throw new Error('This expense has already been rolled back.');
        await assertPeriodNotLocked(expense.date);
        await tx.expense.update({ where: { id: targetId }, data: { isDeleted: true } });
        await reverseJournals(tx, 'EXPENSE', targetId, label);

      } else {
        throw new Error(`Rollback for module ${module} is not supported`);
      }
    }, { maxWait: 10000, timeout: 30000 });

    await logAudit({
      action: 'DELETE',
      module: 'System',
      description: `Rolled back ${module} creation (Log ID: ${logId})`,
      details: { rolledBackLogId: logId, targetId }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Rollback failed' }, { status: 500 });
  }
}
