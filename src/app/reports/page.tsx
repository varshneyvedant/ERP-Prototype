'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/format';

type AgingRow = { id: string; name: string; notDue: number; d1_30: number; d31_60: number; d60plus: number; total: number; oldestDays: number };
type Agg = { key: string; name: string; tons: number; revenue: number; cogs: number; profit: number; marginPct: number; profitPerTon: number };

const TABS = ['Aging', 'Profit', 'Backup'] as const;
const TIMEFRAMES = ['1M', '3M', '6M', '1Y', 'ALL'];
const BACKUP_TABLES = ['sales', 'purchases', 'production', 'expenses', 'payments', 'journals', 'customers', 'suppliers', 'employees'];

function AgingTable({ title, data, note }: { title: string; data: { rows: AgingRow[]; totals: any }; note?: string }) {
  return (
    <div className="card overflow-x-auto">
      <h3 className="text-xl font-bold mb-1">{title}</h3>
      {note && <p className="text-xs text-gray-500 mb-3">{note}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-[#333]">
            <th className="p-2">Party</th><th className="p-2 text-right">Not due</th><th className="p-2 text-right">1–30 late</th>
            <th className="p-2 text-right">31–60 late</th><th className="p-2 text-right text-red-400">60+ late</th><th className="p-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.id} className="border-b border-[#222]">
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2 text-right font-mono">{formatCurrency(r.notDue)}</td>
              <td className="p-2 text-right font-mono">{formatCurrency(r.d1_30)}</td>
              <td className="p-2 text-right font-mono text-orange-400">{formatCurrency(r.d31_60)}</td>
              <td className="p-2 text-right font-mono text-red-400 font-bold">{formatCurrency(r.d60plus)}</td>
              <td className="p-2 text-right font-mono font-bold">{formatCurrency(r.total)}</td>
            </tr>
          ))}
          {data.rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-500">Nothing outstanding 🎉</td></tr>}
        </tbody>
        <tfoot>
          <tr className="font-bold border-t border-[#444]">
            <td className="p-2">TOTAL</td>
            <td className="p-2 text-right font-mono">{formatCurrency(data.totals.notDue)}</td>
            <td className="p-2 text-right font-mono">{formatCurrency(data.totals.d1_30)}</td>
            <td className="p-2 text-right font-mono">{formatCurrency(data.totals.d31_60)}</td>
            <td className="p-2 text-right font-mono text-red-400">{formatCurrency(data.totals.d60plus)}</td>
            <td className="p-2 text-right font-mono">{formatCurrency(data.totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ProfitTable({ title, rows }: { title: string; rows: Agg[] }) {
  return (
    <div className="card overflow-x-auto">
      <h3 className="text-xl font-bold mb-3">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-[#333]">
            <th className="p-2">Name</th><th className="p-2 text-right">Tons</th><th className="p-2 text-right">Revenue</th>
            <th className="p-2 text-right">Cost</th><th className="p-2 text-right">Gross profit</th><th className="p-2 text-right">Margin</th><th className="p-2 text-right">₹/ton</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b border-[#222]">
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2 text-right font-mono">{r.tons.toFixed(2)}</td>
              <td className="p-2 text-right font-mono">{formatCurrency(r.revenue)}</td>
              <td className="p-2 text-right font-mono">{formatCurrency(r.cogs)}</td>
              <td className={`p-2 text-right font-mono font-bold ${r.profit < 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(r.profit)}</td>
              <td className={`p-2 text-right font-mono ${r.marginPct < 0 ? 'text-red-400' : ''}`}>{r.marginPct.toFixed(1)}%</td>
              <td className="p-2 text-right font-mono">{formatCurrency(r.profitPerTon)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-500">No sales in this period</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const { data: session } = useSession();
  const isOwner = ((session?.user as any)?.role || '').toLowerCase() === 'owner';
  const [tab, setTab] = useState<(typeof TABS)[number]>('Aging');
  const [aging, setAging] = useState<any>(null);
  const [profit, setProfit] = useState<any>(null);
  const [timeframe, setTimeframe] = useState('3M');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'Aging') return;
    setLoading(true);
    fetch('/api/reports/aging').then(r => r.json()).then(j => j.success ? setAging(j.data) : toast.error(j.error || 'Failed'))
      .catch(() => toast.error('Failed to load aging report')).finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'Profit') return;
    setLoading(true);
    fetch(`/api/reports/profit?timeframe=${timeframe}`).then(r => r.json()).then(j => j.success ? setProfit(j.data) : toast.error(j.error || 'Failed'))
      .catch(() => toast.error('Failed to load profit report')).finally(() => setLoading(false));
  }, [tab, timeframe]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h2 className="text-3xl font-bold"><span className="text-red-500">Reports</span></h2>

      <div className="flex gap-2 border-b border-[#333]">
        {TABS.filter(t => t !== 'Backup' || isOwner).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${tab === t ? 'border-red-500 text-red-500' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {t === 'Aging' ? 'Receivables / Payables Aging' : t === 'Profit' ? 'Profit by Customer & Product' : 'Backup / Export'}
          </button>
        ))}
      </div>

      {loading && <div className="text-gray-400">Loading...</div>}

      {tab === 'Aging' && aging && (
        <div className="space-y-6">
          <AgingTable title="Customers owe you" data={aging.receivables} note="Late = days beyond each customer's own credit terms." />
          <AgingTable title="You owe suppliers" data={aging.payables} note={aging.payables.termsNote} />
        </div>
      )}

      {tab === 'Profit' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            {TIMEFRAMES.map(t => (
              <button key={t} onClick={() => setTimeframe(t)} className={`px-3 py-1 rounded text-xs font-bold ${timeframe === t ? 'bg-red-500 text-white' : 'bg-[#222] text-gray-400 hover:text-white'}`}>{t}</button>
            ))}
          </div>
          {profit && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card"><div className="text-xs text-gray-400">Revenue</div><div className="text-xl font-bold">{formatCurrency(profit.totals.revenue)}</div></div>
                <div className="card"><div className="text-xs text-gray-400">Cost (FIFO)</div><div className="text-xl font-bold">{formatCurrency(profit.totals.cogs)}</div></div>
                <div className="card"><div className="text-xs text-gray-400">Gross profit</div><div className={`text-xl font-bold ${profit.totals.profit < 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(profit.totals.profit)}</div></div>
                <div className="card"><div className="text-xs text-gray-400">Tons sold</div><div className="text-xl font-bold">{profit.totals.tons.toFixed(2)}</div></div>
              </div>
              <ProfitTable title="By customer" rows={profit.customers} />
              <ProfitTable title="By product" rows={profit.products} />
              <p className="text-xs text-gray-500">{profit.note}</p>
            </>
          )}
        </div>
      )}

      {tab === 'Backup' && isOwner && (
        <div className="card space-y-4">
          <p className="text-sm text-gray-400">
            Download a CSV copy of your books. Do this at least weekly and keep the files somewhere other than this computer (Google Drive, pen-drive).
            Every download is written to the audit log.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {BACKUP_TABLES.map(t => (
              <a key={t} href={`/api/reports/backup?table=${t}`} className="btn-primary text-center capitalize" download>{t}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
