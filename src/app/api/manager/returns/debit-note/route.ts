export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';
import { Prisma } from '@prisma/client';
import { reconcileFIFOBook } from '@/lib/ledger/reconciliation';

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
    const debitNotes = await prisma.debitNote.findMany({
      orderBy: { date: 'desc' },
      include: {
        purchase: {
          include: { supplier: true }
        }
      }
    });
    return NextResponse.json({ debitNotes });
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
  if (role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden. Owner approval required.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { purchaseId, qtyReturned, amountDebited, reason } = body;

    if (!purchaseId || Number(qtyReturned) <= 0 || Number(amountDebited) <= 0) {
      return NextResponse.json({ error: 'Invalid returns input parameters' }, { status: 400 });
    }

    // Period Lock Check
    await assertPeriodNotLocked(new Date());

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { id: purchaseId },
        include: { supplier: true }
      });

      if (!purchase) throw new Error('Raw copper purchase bill not found');
      if (purchase.isDeleted) throw new Error('Cannot process returns on cancelled purchase');

      const batch = await tx.inventoryBatch.findUnique({ where: { purchaseId } });
      if (!batch || Number(batch.remainingQty) + 0.001 < Number(qtyReturned)) {
        throw new Error(`Cannot return ${Number(qtyReturned)}T: only ${Number(batch?.remainingQty ?? 0).toFixed(3)}T of this purchase is still in stock (the rest was already used in production or sold).`);
      }
      const prior = await tx.debitNote.aggregate({ where: { purchaseId }, _sum: { amountDebited: true } });
      if (Number(prior._sum.amountDebited || 0) + Number(amountDebited) > Number(purchase.totalValue) + 0.01) {
        throw new Error('Debit amount exceeds the purchase bill value.');
      }

      // Create Debit Note
      const debitNote = await tx.debitNote.create({
        data: {
          purchaseId,
          qtyReturned: new Prisma.Decimal(Number(qtyReturned)),
          amountDebited: new Prisma.Decimal(Number(amountDebited)),
          reason
        }
      });

      // Issue supplier ledger adjustment: -amountDebited reduces our outstanding accounts payable liability
      await tx.supplierLedger.create({
        data: {
          supplierId: purchase.supplierId,
          date: new Date(),
          amount: -Number(amountDebited),
          description: `Debit Note Issued (Supplier Return) - Record ID: ${debitNote.id}`
        }
      });

      // Post Double-Entry Journal Entry
      await postJournalEntry(tx, {
        date: new Date(),
        description: `Debit Note: Supplier Return to ${purchase.supplier.name} (ID: ${debitNote.id})`,
        referenceType: 'DEBIT_NOTE' as any,
        referenceId: debitNote.id,
        lines: [
          { accountName: 'Accounts Payable', accountType: 'LIABILITY' as const, debit: Number(amountDebited), credit: 0 },
          { accountName: 'Inventory - Raw Materials', accountType: 'ASSET' as const, debit: 0, credit: Number(amountDebited) }
        ]
      });

      // Reduce the purchase's qty and InventoryBatch quantity
      await tx.purchase.update({
          where: { id: purchaseId },
          data: { qty: Number(purchase.qty) - Number(qtyReturned) }
      });

      await tx.inventoryBatch.updateMany({
          where: { purchaseId: purchaseId },
          data: { 
             initialQty: { decrement: Number(qtyReturned) },
             remainingQty: { decrement: Number(qtyReturned) }
          }
      });

      // Trigger FIFO rebalance
      await reconcileFIFOBook(tx);

      return debitNote;
    });

    await logAudit({
      action: 'CREATE',
      module: 'DebitNote',
      description: `Issued Purchase Return Debit Note of ₹${amountDebited} for Purchase ID ${purchaseId}`,
      details: { purchaseId, qtyReturned, amountDebited, reason }
    });

    return NextResponse.json({ success: true, debitNote: result });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
