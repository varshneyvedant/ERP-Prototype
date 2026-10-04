import { describe, it, expect, vi } from 'vitest';
import { applyUnappliedPayments } from './credit';

/** Minimal in-memory stand-in for the Prisma transaction client used by the helper. */
function fakeTx(payments: any[]) {
  const invoicePaymentCreate = vi.fn(async () => ({}));
  const billPaymentCreate = vi.fn(async () => ({}));
  const tx: any = {
    paymentRecord: { findMany: vi.fn(async () => payments) },
    invoicePayment: { create: invoicePaymentCreate },
    billPayment: { create: billPaymentCreate }
  };
  return { tx, invoicePaymentCreate, billPaymentCreate };
}

describe('applyUnappliedPayments', () => {
  it('applies nothing when there are no unapplied payments (the live-data case: creditBalance must be ignored)', async () => {
    // Customer "owes" 85.4L (so creditBalance column would be 8540000) but every payment is fully applied.
    const { tx, invoicePaymentCreate } = fakeTx([
      { id: 'p1', amount: 500000, date: new Date('2026-01-01'), invoicePayments: [{ amountApplied: 500000 }] }
    ]);
    const applied = await applyUnappliedPayments(tx, 'CUSTOMER', 'c1', 's1', 1_000_000);
    expect(applied).toBe(0);
    expect(invoicePaymentCreate).not.toHaveBeenCalled();
  });

  it('applies a true prepayment, oldest payment first, never exceeding the amount due', async () => {
    const { tx, invoicePaymentCreate } = fakeTx([
      { id: 'p1', amount: 300000, date: new Date('2026-01-01'), invoicePayments: [{ amountApplied: 100000 }] }, // 200k free
      { id: 'p2', amount: 500000, date: new Date('2026-02-01'), invoicePayments: [] } // 500k free
    ]);
    const applied = await applyUnappliedPayments(tx, 'CUSTOMER', 'c1', 's1', 350000);
    expect(applied).toBe(350000);
    expect(invoicePaymentCreate).toHaveBeenNthCalledWith(1, { data: { paymentRecordId: 'p1', saleId: 's1', amountApplied: 200000 } });
    expect(invoicePaymentCreate).toHaveBeenNthCalledWith(2, { data: { paymentRecordId: 'p2', saleId: 's1', amountApplied: 150000 } });
  });

  it('works for suppliers via bill payments', async () => {
    const { tx, billPaymentCreate } = fakeTx([
      { id: 'p1', amount: 100000, date: new Date('2026-01-01'), billPayments: [] }
    ]);
    const applied = await applyUnappliedPayments(tx, 'SUPPLIER', 'sup1', 'pur1', 40000);
    expect(applied).toBe(40000);
    expect(billPaymentCreate).toHaveBeenCalledWith({ data: { paymentRecordId: 'p1', purchaseId: 'pur1', amountApplied: 40000 } });
  });

  it('returns 0 for a zero or negative amount due', async () => {
    const { tx } = fakeTx([]);
    expect(await applyUnappliedPayments(tx, 'CUSTOMER', 'c1', 's1', 0)).toBe(0);
    expect(await applyUnappliedPayments(tx, 'CUSTOMER', 'c1', 's1', -5)).toBe(0);
  });
});
