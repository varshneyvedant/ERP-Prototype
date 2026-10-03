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
    const creditNotes = await prisma.creditNote.findMany({
      orderBy: { date: 'desc' },
      include: {
        sale: {
          include: { customer: true }
        }
      }
    });
    return NextResponse.json({ creditNotes });
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

  try {
    const body = await request.json();
    const { saleId, qtyReturned, amountCredited, reason } = body;

    if (!saleId || Number(qtyReturned) <= 0 || Number(amountCredited) <= 0) {
      return NextResponse.json({ error: 'Invalid returns input parameters' }, { status: 400 });
    }

    // Period Lock Check
    await assertPeriodNotLocked(new Date());

    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { customer: true, items: true }
      });

      if (!sale) throw new Error('Invoice Sale not found');
      if (sale.isDeleted) throw new Error('Cannot process returns on cancelled invoice');

      const prior = await tx.creditNote.aggregate({
        where: { saleId },
        _sum: { qtyReturned: true, amountCredited: true }
      });
      const soldQty = sale.items.reduce((acc, item) => acc + Number(item.qty), 0);
      const priorQty = Number(prior._sum.qtyReturned || 0);
      const priorAmt = Number(prior._sum.amountCredited || 0);
      if (priorQty + Number(qtyReturned) > soldQty + 0.001) {
        throw new Error(`Return quantity exceeds invoice: sold ${soldQty}T, already returned ${priorQty}T.`);
      }
      if (priorAmt + Number(amountCredited) > Number(sale.totalValue) + 0.01) {
        throw new Error(`Credit amount exceeds invoice value: invoice ₹${Number(sale.totalValue)}, already credited ₹${priorAmt}.`);
      }

      // Create Credit Note
      const creditNote = await tx.creditNote.create({
        data: {
          saleId,
          qtyReturned: new Prisma.Decimal(Number(qtyReturned)),
          amountCredited: new Prisma.Decimal(Number(amountCredited)),
          reason
        }
      });

      // Issue customer ledger adjustment: -amountCredited reduces their net accounts receivable balance
      await tx.customerLedger.create({
        data: {
          customerId: sale.customerId,
          date: new Date(),
          amount: -Number(amountCredited),
          description: `Credit Note Issued (Sales Return) - Record ID: ${creditNote.id}`
        }
      });

      // Calculate COGS amount to reverse
      const totalSaleQty = sale.items.reduce((acc, item) => acc + Number(item.qty), 0);
      const totalCogs = sale.items.reduce((acc, item) => acc + (Number(item.qty) * Number(item.rawCopperCostAtSale)), 0);
      const cogsAmount = totalSaleQty > 0 ? (totalCogs / totalSaleQty) * Number(qtyReturned) : 0;

      // Post Double-Entry Journal Entry
      await postJournalEntry(tx, {
        date: new Date(),
        description: `Credit Note: Sales Return from ${sale.customer.name} (ID: ${creditNote.id})`,
        referenceType: 'CREDIT_NOTE' as any,
        referenceId: creditNote.id,
        lines: [
          { accountName: 'Sales Revenue', accountType: 'REVENUE' as const, debit: Number(amountCredited), credit: 0 },
          { accountName: 'Accounts Receivable', accountType: 'ASSET' as const, debit: 0, credit: Number(amountCredited) },
          { accountName: 'Inventory', accountType: 'ASSET' as const, debit: cogsAmount, credit: 0 },
          { accountName: 'Cost of Goods Sold', accountType: 'EXPENSE' as const, debit: 0, credit: cogsAmount }
        ]
      });

      // Restore inventory
      const mainItem = sale.items[0];
      if (mainItem) {
          const recentBatch = await tx.finishedGoodsBatch.findFirst({
              where: { 
                 productCategory: mainItem.productCategory,
                 brand: mainItem.brand,
                 wireType: mainItem.wireType || ''
              },
              orderBy: { date: 'desc' }
          });
          if (recentBatch) {
             await tx.finishedGoodsBatch.update({
                 where: { id: recentBatch.id },
                 data: { remainingQty: Number(recentBatch.remainingQty) + Number(qtyReturned) }
             });
          }
      }

      return creditNote;
    });

    await logAudit({
      action: 'CREATE',
      module: 'CreditNote',
      description: `Issued Sales Return Credit Note of ₹${amountCredited} for Sale ID ${saleId}`,
      details: { saleId, qtyReturned, amountCredited, reason }
    });

    return NextResponse.json({ success: true, creditNote: result });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
