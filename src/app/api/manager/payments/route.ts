import { ManagerPaymentPostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { assertPeriodNotLocked } from '@/lib/periodLock';
import { postJournalEntry } from '@/lib/ledger/journal';
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
    const payments = await prisma.paymentRecord.findMany({
      orderBy: { date: 'desc' },
      take: 15,
      include: {
        customer: true,
        supplier: true
      }
    });
    return NextResponse.json({ payments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    await prisma.$transaction(async (tx) => {
       const payment = await tx.paymentRecord.findUnique({
          where: { id },
          include: { invoicePayments: true, billPayments: true }
       });
       if (!payment) throw new Error('Payment record not found');

       if (payment.status === 'APPROVED' && role !== 'owner') {
         throw new Error('Only the Owner can reverse an approved payment.');
       }

       // Assert period not locked
       await assertPeriodNotLocked(payment.date);

       // Revert balances, ledger posts, and journals ONLY if payment was approved
       if (payment.status === 'APPROVED') {
          if (payment.type === 'INCOMING') {
             // Revert sales invoice payments
             for (const ip of payment.invoicePayments) {
                const sale = await tx.sale.findUnique({ where: { id: ip.saleId } });
                if (sale) {
                   const newAmountPaid = Math.max(0, Number(sale.amountPaid) - Number(ip.amountApplied));
                   await tx.sale.update({
                      where: { id: sale.id },
                      data: {
                         amountPaid: newAmountPaid,
                         fullyPaidDate: null
                      }
                   });
                }
                await tx.invoicePayment.delete({ where: { id: ip.id } });
             }

             // If credit balance was incremented, decrement it
             const totalApplied = payment.invoicePayments.reduce((sum, ip) => sum + Number(ip.amountApplied), 0);
             const remainder = Number(payment.amount) - totalApplied;
             if (remainder > 0 && payment.customerId) {
                await tx.customer.update({
                   where: { id: payment.customerId },
                   data: { creditBalance: { decrement: remainder } }
                });
             }

             // Delete customer ledger entries related to this payment
             await tx.customerLedger.deleteMany({
                where: { customerId: payment.customerId || undefined, description: { contains: `Record ID: ${payment.id}` } }
             });

          } else if (payment.type === 'OUTGOING') {
             // Revert bill payments
             for (const bp of payment.billPayments) {
                const purchase = await tx.purchase.findUnique({ where: { id: bp.purchaseId } });
                if (purchase) {
                   const newAmountPaid = Math.max(0, Number(purchase.amountPaid) - Number(bp.amountApplied));
                   await tx.purchase.update({
                      where: { id: purchase.id },
                      data: {
                         amountPaid: newAmountPaid,
                         fullyPaidDate: null
                      }
                   });
                }
                await tx.billPayment.delete({ where: { id: bp.id } });
             }

             // If credit balance was incremented, decrement it
             const totalApplied = payment.billPayments.reduce((sum, bp) => sum + Number(bp.amountApplied), 0);
             const remainder = Number(payment.amount) - totalApplied;
             if (remainder > 0 && payment.supplierId) {
                await tx.supplier.update({
                   where: { id: payment.supplierId },
                   data: { creditBalance: { decrement: remainder } }
                });
             }

             // Delete supplier ledger entries related to this payment
             await tx.supplierLedger.deleteMany({
                where: { supplierId: payment.supplierId || undefined, description: { contains: `Record ID: ${payment.id}` } }
             });
          }

          // Delete corresponding double-entry journal logs
          await tx.journalEntry.deleteMany({
             where: { referenceType: 'PAYMENT', referenceId: payment.id }
          });
       }

       // Delete the payment record itself
       await tx.paymentRecord.delete({ where: { id: payment.id } });
    });

    await logAudit({
       action: 'DELETE',
       module: 'Payment',
       description: `Undid payment record ID ${id}`,
    });

    return NextResponse.json({ success: true });
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
    const isManager = role === 'manager';

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

    const validation = ManagerPaymentPostSchema.safeParse(body);
    if (!validation.success) {
      const errRes = { error: "Invalid data", details: validation.error.format() };
      if (idempotencyKey) await completeIdempotency(idempotencyKey, 'FAILED', errRes);
      return NextResponse.json(errRes, { status: 400 });
    }
    const { type, stakeholderId, amount } = validation.data;
    const paymentAmount = Number(amount);

    // Assert period locking
    await assertPeriodNotLocked(new Date());

    // 1. Manager Flow: Payment is set to PENDING (no ledger/invoice impact)
    if (isManager) {
      const pendingPayment = await prisma.paymentRecord.create({
        data: {
          date: new Date(),
          amount: paymentAmount,
          type: type === 'INCOMING' ? 'INCOMING' : 'OUTGOING',
          customerId: type === 'INCOMING' ? stakeholderId : null,
          supplierId: type === 'OUTGOING' ? stakeholderId : null,
          idempotencyKey: idempotencyKey || undefined,
          status: 'PENDING',
          description: `Lump-sum Payment (${type === 'INCOMING' ? 'Customer Paid Us' : 'We Paid Supplier'}) - Pending Owner Approval`
        }
      });

      await logAudit({
        action: 'CREATE',
        module: 'Payment',
        description: `Logged pending stakeholder payment of ₹${paymentAmount} (Pending Authorization)`,
        details: { id: pendingPayment.id, type, stakeholderId, amount: paymentAmount }
      });

      const successRes = { success: true, message: 'Payment successfully submitted for Owner Authorization.' };
      if (idempotencyKey) await completeIdempotency(idempotencyKey, 'SUCCESS', successRes);
      return NextResponse.json(successRes);
    }

    // 2. Owner Flow: Payment is AUTO-APPROVED and immediately posted to ledger & journals
    const result = await prisma.$transaction(async (tx) => {
      if (type === 'INCOMING') {
        const paymentRecord = await tx.paymentRecord.create({
           data: {
             date: new Date(),
             amount: paymentAmount,
             type: "INCOMING",
             customerId: stakeholderId,
             idempotencyKey: idempotencyKey || undefined,
             status: 'APPROVED',
             description: 'Lump-sum Payment from Customer'
           }
        });

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
                 fullyPaidDate: newAmountPaid >= Number(sale.totalValue) ? new Date() : null
             }
          });

          await tx.invoicePayment.create({
             data: {
                 paymentRecordId: paymentRecord.id,
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
            date: new Date(),
            amount: -paymentAmount,
            description: `Payment Received (Record ID: ${paymentRecord.id})`
          }
        });

        // Post balanced Double-Entry Journal
        const customer = await tx.customer.findUnique({ where: { id: stakeholderId } });
        const customerName = customer ? customer.name : 'Customer';

        await postJournalEntry(tx, {
          date: new Date(),
          description: `Customer Payment from ${customerName} (ID: ${paymentRecord.id})`,
          referenceType: 'PAYMENT',
          referenceId: paymentRecord.id,
          lines: [
            { accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: paymentAmount, credit: 0 },
            { accountName: 'Accounts Receivable', accountType: 'ASSET' as const, debit: 0, credit: paymentAmount }
          ]
        });

      } else if (type === 'OUTGOING') {
        const paymentRecord = await tx.paymentRecord.create({
           data: {
             date: new Date(),
             amount: paymentAmount,
             type: "OUTGOING",
             supplierId: stakeholderId,
             idempotencyKey: idempotencyKey || undefined,
             status: 'APPROVED',
             description: 'Lump-sum Payment to Supplier'
           }
        });

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
                 fullyPaidDate: newAmountPaid >= Number(purchase.totalValue) ? new Date() : null
             }
          });

          await tx.billPayment.create({
             data: {
                 paymentRecordId: paymentRecord.id,
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
            date: new Date(),
            amount: -paymentAmount,
            description: `Payment Sent (Record ID: ${paymentRecord.id})`
          }
        });

        // Post balanced Double-Entry Journal
        const supplier = await tx.supplier.findUnique({ where: { id: stakeholderId } });
        const supplierName = supplier ? supplier.name : 'Supplier';

        await postJournalEntry(tx, {
          date: new Date(),
          description: `Supplier Payment to ${supplierName} (ID: ${paymentRecord.id})`,
          referenceType: 'PAYMENT',
          referenceId: paymentRecord.id,
          lines: [
            { accountName: 'Accounts Payable', accountType: 'LIABILITY' as const, debit: paymentAmount, credit: 0 },
            { accountName: 'Cash & Bank', accountType: 'ASSET' as const, debit: 0, credit: paymentAmount }
          ]
        });
      }

      return { success: true };
    });

    await logAudit({
      action: 'CREATE',
      module: 'Payment',
      description: `Logged stakeholder payment of ₹${paymentAmount} (${type === 'INCOMING' ? 'Customer Paid Us' : 'We Paid Supplier'})`,
      details: { type, stakeholderId, amount: paymentAmount, status: 'APPROVED' }
    });

    const successRes = { success: true };
    if (idempotencyKey) {
      await completeIdempotency(idempotencyKey, 'SUCCESS', successRes);
    }
    return NextResponse.json(successRes);
  } catch (error: any) {
    console.error(error);
    const errRes = { error: error.message || 'Database transaction failed' };
    if (idempotencyKey) await completeIdempotency(idempotencyKey, 'FAILED', errRes);
    return NextResponse.json(errRes, { status: 500 });
  }
}
