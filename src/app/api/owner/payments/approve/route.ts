import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';


import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role?.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { paymentId, action } = body;

    if (!paymentId || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    // Assert period locking
    await assertPeriodNotLocked(new Date());

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRecord.findUnique({
        where: { id: paymentId }
      });

      if (!payment) throw new Error('Payment record not found');
      if (payment.status !== 'PENDING') throw new Error('Payment record is not in PENDING status');

      if (action === 'REJECT') {
        const updated = await tx.paymentRecord.update({
          where: { id: paymentId },
          data: { status: 'REJECTED' }
        });
        return updated;
      }

      // Action: APPROVE
      // Update status to APPROVED and set date to today (approval date)
      const approvedDate = new Date();
      const updatedPayment = await tx.paymentRecord.update({
        where: { id: paymentId },
        data: {
          status: 'APPROVED',
          date: approvedDate
        }
      });

      const paymentAmount = Number(payment.amount);

      if (payment.type === 'INCOMING') {
        const stakeholderId = payment.customerId;
        if (!stakeholderId) throw new Error('Missing Customer ID on payment record');

        const allSales = await tx.sale.findMany({
          where: { isDeleted: false, customerId: stakeholderId },
          orderBy: { date: 'asc' }
        });
        const unpaidSales = allSales.filter(s => Number(s.amountPaid) < Number(s.totalValue));

        let remainingPayment = paymentAmount;

        for (const sale of unpaidSales) {
          if (remainingPayment <= 0) break;

          const due = Number(sale.totalValue) - Number(sale.amountPaid);
          const payToThisInvoice = Math.min(due, remainingPayment);

          const newAmountPaid = Number(sale.amountPaid) + payToThisInvoice;
          await tx.sale.update({
             where: { id: sale.id },
             data: {
                 amountPaid: newAmountPaid,
                 fullyPaidDate: newAmountPaid >= Number(sale.totalValue) ? approvedDate : null
             }
          });

          await tx.invoicePayment.create({
             data: {
                 paymentRecordId: paymentId,
                 saleId: sale.id,
                 amountApplied: payToThisInvoice
             }
          });

          remainingPayment -= payToThisInvoice;
        }

        if (remainingPayment > 0) {
           await tx.customer.update({
              where: { id: stakeholderId },
              data: { creditBalance: { increment: remainingPayment } }
           });
        }

        await tx.customerLedger.create({
          data: {
            customerId: stakeholderId,
            date: approvedDate,
            amount: -paymentAmount,
            description: `Payment Received (Record ID: ${paymentId})`
          }
        });

        // Post balanced Double-Entry Journal
        const customer = await tx.customer.findUnique({ where: { id: stakeholderId } });
        const customerName = customer ? customer.name : 'Customer';

        await postJournalEntry(tx, {
          date: approvedDate,
          description: `Customer Payment Approved for ${customerName} (ID: ${paymentId})`,
          referenceType: 'PAYMENT',
          referenceId: paymentId,
          lines: [
            { accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: paymentAmount, credit: 0 },
            { accountName: 'Accounts Receivable', accountType: 'ASSET' as const, debit: 0, credit: paymentAmount }
          ]
        });

      } else if (payment.type === 'OUTGOING') {
        const stakeholderId = payment.supplierId;
        if (!stakeholderId) throw new Error('Missing Supplier ID on payment record');

        const allPurchases = await tx.purchase.findMany({
          where: { isDeleted: false, supplierId: stakeholderId },
          orderBy: { date: 'asc' }
        });
        const unpaidPurchases = allPurchases.filter(p => Number(p.amountPaid) < Number(p.totalValue));

        let remainingPayment = paymentAmount;

        for (const purchase of unpaidPurchases) {
          if (remainingPayment <= 0) break;

          const due = Number(purchase.totalValue) - Number(purchase.amountPaid);
          const payToThisInvoice = Math.min(due, remainingPayment);

          const newAmountPaid = Number(purchase.amountPaid) + payToThisInvoice;
          await tx.purchase.update({
             where: { id: purchase.id },
             data: {
                 amountPaid: newAmountPaid,
                 fullyPaidDate: newAmountPaid >= Number(purchase.totalValue) ? approvedDate : null
             }
          });

          await tx.billPayment.create({
             data: {
                 paymentRecordId: paymentId,
                 purchaseId: purchase.id,
                 amountApplied: payToThisInvoice
             }
          });

          remainingPayment -= payToThisInvoice;
        }

        if (remainingPayment > 0) {
           await tx.supplier.update({
              where: { id: stakeholderId },
              data: { creditBalance: { increment: remainingPayment } }
           });
        }

        await tx.supplierLedger.create({
          data: {
            supplierId: stakeholderId,
            date: approvedDate,
            amount: -paymentAmount,
            description: `Payment Sent (Record ID: ${paymentId})`
          }
        });

        // Post balanced Double-Entry Journal
        const supplier = await tx.supplier.findUnique({ where: { id: stakeholderId } });
        const supplierName = supplier ? supplier.name : 'Supplier';

        await postJournalEntry(tx, {
          date: approvedDate,
          description: `Supplier Payment Approved to ${supplierName} (ID: ${paymentId})`,
          referenceType: 'PAYMENT',
          referenceId: paymentId,
          lines: [
            { accountName: 'Accounts Payable', accountType: 'LIABILITY' as const, debit: paymentAmount, credit: 0 },
            { accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: 0, credit: paymentAmount }
          ]
        });
      }

      return updatedPayment;
    });

    await logAudit({
      action: 'UPDATE',
      module: 'Payment',
      description: `Owner authorized payment record ID ${paymentId} to ${action}`,
      details: { paymentId, action }
    });

    return NextResponse.json({ success: true, payment: result });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
