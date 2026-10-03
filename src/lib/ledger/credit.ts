import { Prisma } from '@prisma/client';

/**
 * Applies a party's genuinely UNAPPLIED approved payments (payment amount minus what was already
 * allocated to invoices/bills) to a newly created document, oldest payment first.
 *
 * Why not Customer.creditBalance / Supplier.creditBalance?  Those columns are not reliable: the seed
 * script and the directory API store the OUTSTANDING RECEIVABLE/PAYABLE in them, so reading them as
 * "prepaid credit" would auto-mark invoices as paid. The payment records are the source of truth.
 *
 * Returns the total amount applied (0 if none).
 */
export async function applyUnappliedPayments(
  tx: Prisma.TransactionClient,
  kind: 'CUSTOMER' | 'SUPPLIER',
  partyId: string,
  documentId: string,
  amountDue: number
): Promise<number> {
  if (amountDue <= 0) return 0;
  let remaining = amountDue;
  let applied = 0;

  if (kind === 'CUSTOMER') {
    const payments = await tx.paymentRecord.findMany({
      where: { customerId: partyId, type: 'INCOMING', status: 'APPROVED' },
      include: { invoicePayments: true },
      orderBy: { date: 'asc' }
    });
    for (const p of payments) {
      if (remaining <= 0.004) break;
      const used = p.invoicePayments.reduce((s, ip) => s + Number(ip.amountApplied), 0);
      const free = Number(p.amount) - used;
      if (free <= 0.004) continue;
      const take = Math.min(free, remaining);
      await tx.invoicePayment.create({ data: { paymentRecordId: p.id, saleId: documentId, amountApplied: take } });
      remaining -= take;
      applied += take;
    }
  } else {
    const payments = await tx.paymentRecord.findMany({
      where: { supplierId: partyId, type: 'OUTGOING', status: 'APPROVED' },
      include: { billPayments: true },
      orderBy: { date: 'asc' }
    });
    for (const p of payments) {
      if (remaining <= 0.004) break;
      const used = p.billPayments.reduce((s, bp) => s + Number(bp.amountApplied), 0);
      const free = Number(p.amount) - used;
      if (free <= 0.004) continue;
      const take = Math.min(free, remaining);
      await tx.billPayment.create({ data: { paymentRecordId: p.id, purchaseId: documentId, amountApplied: take } });
      remaining -= take;
      applied += take;
    }
  }
  return Math.round(applied * 100) / 100;
}
