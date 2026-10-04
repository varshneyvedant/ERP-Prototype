import { ManagerSalesPostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';
import { reconcileFIFOBook } from '@/lib/ledger/reconciliation';
import { applyUnappliedPayments } from '@/lib/ledger/credit';

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
    const sales = await prisma.sale.findMany({ 
      where: { isDeleted: false },
      orderBy: { date: 'desc' },
      take: 10,
      include: {
         customer: { select: { name: true, contact: true, transport: true } },
         items: true
      }
    });
    return NextResponse.json({ sales });
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
    const validation = ManagerSalesPostSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { customerId, date, items, overridePin } = validation.data;

    const recordDate = date ? new Date(date) : new Date();
    await assertPeriodNotLocked(recordDate);

    const result = await prisma.$transaction(async (tx) => {
      let grandTotal = 0;
      const saleItemsData = [];

      for (const item of items) {
          const qty = Number(item.qty);
          const pricePerTon = (Number(item.pricePerKg) || 0) * 1000;
          const totalValue = Math.round(qty * pricePerTon * 100) / 100;
          grandTotal = Math.round((grandTotal + totalValue) * 100) / 100;

          if (qty < 0.01 || pricePerTon < 0.01) {
              throw new Error('Quantity and price must be greater than zero.');
          }

          // Handle Sauda Rate Booking Quota Deduction
          if (item.saudaContractId) {
            const sauda = await tx.saudaContract.findUnique({
              where: { id: item.saudaContractId }
            });
            if (!sauda || sauda.status !== 'ACTIVE') {
              throw new Error('Selected Sauda Contract is no longer active.');
            }
            const remaining = Number(sauda.remainingQty);
            if (qty > remaining + 0.001) {
              throw new Error(`Item quantity ${qty}T exceeds remaining Sauda quota of ${remaining.toFixed(2)}T.`);
            }
            const newRemaining = Math.max(0, remaining - qty);
            await tx.saudaContract.update({
              where: { id: sauda.id },
              data: {
                remainingQty: newRemaining,
                status: newRemaining <= 0.001 ? 'COMPLETED' : 'ACTIVE'
              }
            });
          }

          let itemCogsPerTon = 0;

          if (item.productCategory === 'Raw Copper Bundle') {
              let remainingToDeduct = qty;
              const batches = await tx.inventoryBatch.findMany({
                  where: { remainingQty: { gt: 0 } },
                  orderBy: { date: 'asc' }
              });

              let totalRawCost = 0;
              let deductedTons = 0;

              for (const batch of batches) {
                  if (remainingToDeduct <= 0) break;
                  const availableInBatch = Number(batch.remainingQty);
                  const deductAmount = Math.min(availableInBatch, remainingToDeduct);
                  
                  totalRawCost += deductAmount * Number(batch.pricePerTon);
                  deductedTons += deductAmount;

                  await tx.inventoryBatch.update({
                      where: { id: batch.id },
                      data: { remainingQty: Math.max(0, availableInBatch - deductAmount) }
                  });
                  remainingToDeduct -= deductAmount;
              }

              if (remainingToDeduct > 0.001) {
                  throw new Error(`Not enough Raw Copper Bundle in stock. Short by: ${remainingToDeduct.toFixed(2)} Tons`);
              }

              itemCogsPerTon = deductedTons > 0 ? (totalRawCost / deductedTons) : 0;

          } else {
              let remainingToDeduct = qty;
              const batches = await tx.finishedGoodsBatch.findMany({
                  where: { 
                      remainingQty: { gt: 0 },
                      productCategory: item.productCategory,
                      brand: item.brand || null,
                      wireType: item.wireType || ''
                  },
                  orderBy: { date: 'asc' }
              });

              let totalWireCost = 0;
              let deductedTons = 0;

              for (const batch of batches) {
                  if (remainingToDeduct <= 0) break;
                  const availableInBatch = Number(batch.remainingQty);
                  const deductAmount = Math.min(availableInBatch, remainingToDeduct);
                  
                  totalWireCost += deductAmount * Number(batch.costPerTon);
                  deductedTons += deductAmount;

                  await tx.finishedGoodsBatch.update({
                      where: { id: batch.id },
                      data: { remainingQty: Math.max(0, availableInBatch - deductAmount) }
                  });
                  remainingToDeduct -= deductAmount;
              }

              if (remainingToDeduct > 0.001) {
                  throw new Error(`Not enough ${item.brand || ''} ${item.wireType || ''} ${item.productCategory} in stock. Short by: ${remainingToDeduct.toFixed(2)} Tons`);
              }

              itemCogsPerTon = deductedTons > 0 ? (totalWireCost / deductedTons) : 0;
          }

          saleItemsData.push({
              productCategory: item.productCategory,
              brand: item.brand || null,
              wireType: item.wireType || null,
              saudaContractId: item.saudaContractId || null,
              qty: qty,
              pricePerTon: pricePerTon,
              totalValue: totalValue,
              rawCopperCostAtSale: itemCogsPerTon
          });
      }

      // Customer Credit Limit & 18-Day Overdue Dispatch Lock Check
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new Error('Customer not found');

      const totalInvoicedAgg = await tx.sale.aggregate({ where: { customerId, isDeleted: false }, _sum: { totalValue: true } });
      const totalPaidAgg = await tx.paymentRecord.aggregate({ where: { customerId, status: 'APPROVED' }, _sum: { amount: true } });
      
      const totalInvoiced = Number(totalInvoicedAgg._sum.totalValue || 0);
      const totalPaid = Number(totalPaidAgg._sum.amount || 0);
      const currentBalance = totalInvoiced - totalPaid;

      const creditDays = customer.creditDays || 18;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - creditDays);

      const oldSales = await tx.sale.findMany({
          where: { customerId, isDeleted: false, date: { lt: cutoffDate } },
          select: { amountPaid: true, totalValue: true }
      });
      const hasOverdueInvoices = oldSales.some(s => Number(s.amountPaid) < Number(s.totalValue));

      const creditLimit = Number(customer.creditLimit || 7000000);
      const isLimitExceeded = currentBalance > creditLimit;

      // Active Sauda Bypass Check: If customer has active Sauda contracts, selling at Spot Price requires Owner PIN
      const activeSaudaCount = await tx.saudaContract.count({
        where: { customerId, status: 'ACTIVE', remainingQty: { gt: 0.001 } }
      });
      const hasUnmappedItems = items.some(i => !i.saudaContractId);

      if ((isLimitExceeded || hasOverdueInvoices || (activeSaudaCount > 0 && hasUnmappedItems)) && role !== 'owner') {
        const serverPin = process.env.OVERRIDE_PIN;
        if (!serverPin || !overridePin || overridePin !== serverPin) {
          let reason = '';
          if (activeSaudaCount > 0 && hasUnmappedItems) {
            reason = 'Customer has active Sauda booking contract(s). Bypassing Sauda to sell at Spot Price requires Owner PIN.';
          } else if (isLimitExceeded && hasOverdueInvoices) {
            reason = `Existing credit limit exceeded (Prior Unpaid Balance: ₹${currentBalance.toLocaleString('en-IN')} > Limit: ₹${creditLimit.toLocaleString('en-IN')}) AND party has unpaid invoices older than ${creditDays} days.`;
          } else if (isLimitExceeded) {
            reason = `Existing credit limit exceeded: Party already owes ₹${currentBalance.toLocaleString('en-IN')} which exceeds their allowed limit of ₹${creditLimit.toLocaleString('en-IN')}.`;
          } else {
            reason = `Customer has overdue invoices older than ${creditDays} days pending clearance.`;
          }
          throw new Error(`DISPATCH_LOCKED: ${reason} Owner Override PIN is required to dispatch.`);
        }
      }

      // Duplicate-submission guard (double-click / retry): identical invoice for the same customer in last 20s
      const dupe = await tx.sale.findFirst({
        where: {
          customerId,
          isDeleted: false,
          totalValue: grandTotal,
          createdAt: { gt: new Date(Date.now() - 20_000) }
        },
        select: { id: true }
      });
      if (dupe) {
        throw new Error('DUPLICATE_SUBMISSION: An identical invoice for this customer was just created. If this is intentional, wait 20 seconds and retry.');
      }

      const sale = await tx.sale.create({
        data: {
          customerId,
          date: recordDate,
          totalValue: grandTotal,
          items: {
            create: saleItemsData
          }
        }
      });

      // Apply any genuinely unapplied approved payments (true prepayments) to this invoice.
      const appliedPrepaid = await applyUnappliedPayments(tx, 'CUSTOMER', customerId, sale.id, grandTotal);
      if (appliedPrepaid > 0) {
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            amountPaid: appliedPrepaid,
            fullyPaidDate: appliedPrepaid + 0.005 >= grandTotal ? recordDate : null
          }
        });
      }

      await tx.customerLedger.create({
        data: {
          customerId,
          date: recordDate,
          amount: grandTotal,
          description: `Invoice Sale ID: ${sale.id} (${items.length} items)`
        }
      });

      // NOTE: No extra ledger entry for applied prepayments - the payment already posted its full
      // negative amount to CustomerLedger when it was received.

      // Post Double-Entry Journal Entry
      const customerName = customer.name;
      const totalCogs = saleItemsData.reduce((sum, item) => sum + (Number(item.qty) * Number(item.rawCopperCostAtSale)), 0);

      const journalLines: { accountName: string; accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'; debit: number; credit: number; }[] = [
        { accountName: 'Accounts Receivable', accountType: 'ASSET', debit: grandTotal, credit: 0 },
        { accountName: 'Sales Revenue', accountType: 'REVENUE', debit: 0, credit: grandTotal }
      ];

      if (totalCogs > 0) {
        journalLines.push(
          { accountName: 'Cost of Goods Sold', accountType: 'EXPENSE' as const, debit: totalCogs, credit: 0 },
          { accountName: 'Inventory - Finished Goods', accountType: 'ASSET' as const, debit: 0, credit: totalCogs }
        );
      }

      await postJournalEntry(tx, {
        date: recordDate,
        description: `Invoice Sale to ${customerName} (ID: ${sale.id})`,
        referenceType: 'SALE',
        referenceId: sale.id,
        lines: journalLines
      });

      return sale;
    }, { maxWait: 10000, timeout: 30000 });

    await logAudit({
      action: 'CREATE',
      module: 'Sales',
      description: `Created sale for customer ID ${customerId}`,
      details: { id: result.id, items }
    });

    return NextResponse.json({ success: true, sale: result });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
