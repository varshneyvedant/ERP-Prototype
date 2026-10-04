import { describe, it, expect, vi } from 'vitest';
import { postJournalEntry } from './journal';

function fakeTx() {
  const create = vi.fn(async ({ data }: any) => ({ id: 'je1', ...data }));
  return { tx: { journalEntry: { create } } as any, create };
}

describe('postJournalEntry', () => {
  it('posts a balanced entry', async () => {
    const { tx, create } = fakeTx();
    await postJournalEntry(tx, {
      description: 'sale',
      lines: [
        { accountName: 'Accounts Receivable', accountType: 'ASSET', debit: 1000, credit: 0 },
        { accountName: 'Sales Revenue', accountType: 'REVENUE', debit: 0, credit: 1000 }
      ]
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('rejects an unbalanced entry', async () => {
    const { tx, create } = fakeTx();
    await expect(
      postJournalEntry(tx, {
        description: 'bad',
        lines: [
          { accountName: 'Cash & Bank', accountType: 'ASSET', debit: 1000, credit: 0 },
          { accountName: 'Sales Revenue', accountType: 'REVENUE', debit: 0, credit: 999 }
        ]
      })
    ).rejects.toThrow(/Double-Entry Bookkeeping Mismatch/);
    expect(create).not.toHaveBeenCalled();
  });

  it('rounds each line to paise before checking balance (no float drift)', async () => {
    const { tx } = fakeTx();
    // 0.1 + 0.2 style drift must not break a balanced entry
    await expect(
      postJournalEntry(tx, {
        description: 'drift',
        lines: [
          { accountName: 'A', accountType: 'ASSET', debit: 0.1 + 0.2, credit: 0 },
          { accountName: 'B', accountType: 'REVENUE', debit: 0, credit: 0.3 }
        ]
      })
    ).resolves.toBeDefined();
  });

  it('rejects an empty entry', async () => {
    const { tx } = fakeTx();
    await expect(postJournalEntry(tx, { description: 'none', lines: [] })).rejects.toThrow();
  });

  it('production-style entry (FG + Scrap = Raw + Overhead) balances', async () => {
    const { tx } = fakeTx();
    const totalRawCost = 1_000_000;
    const scrap = Math.round(0.03 * 1.0 * 1_000_000 * 0.85 * 100) / 100; // 3% scrap at 85% recovery
    const overhead = 12_345.67;
    const wireRawCost = totalRawCost - scrap;
    await expect(
      postJournalEntry(tx, {
        description: 'production',
        lines: [
          { accountName: 'Inventory - Finished Goods', accountType: 'ASSET', debit: wireRawCost + overhead, credit: 0 },
          { accountName: 'Inventory - Raw Materials', accountType: 'ASSET', debit: 0, credit: totalRawCost },
          { accountName: 'Inventory - Scrap', accountType: 'ASSET', debit: scrap, credit: 0 },
          { accountName: 'Manufacturing Overhead Absorbed', accountType: 'EXPENSE', debit: 0, credit: overhead }
        ]
      })
    ).resolves.toBeDefined();
  });
});
