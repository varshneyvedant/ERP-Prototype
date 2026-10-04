'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/format';

type Emp = { id: string; name: string; role: string; baseSalary: number; totalAdvances: number };
type RowState = { gross: string; deduct: string; busy: boolean; done: boolean };

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function SalaryPayoutPage() {
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [month, setMonth] = useState(thisMonth());
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/owner/employees');
      const json = await res.json();
      const list: Emp[] = json.employees || [];
      setEmployees(list);
      setRows(Object.fromEntries(list.map(e => [e.id, { gross: String(e.baseSalary), deduct: '0', busy: false, done: false }])));
    } catch {
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const set = (id: string, patch: Partial<RowState>) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }));

  const pay = async (e: Emp) => {
    const r = rows[e.id];
    const gross = Number(r.gross);
    const deduct = Number(r.deduct || 0);
    if (!(gross > 0)) return toast.error('Enter a gross salary above 0');
    if (deduct < 0 || deduct > gross) return toast.error('Deduction must be between 0 and the gross salary');
    if (deduct > e.totalAdvances + 0.005) return toast.error(`Only ${formatCurrency(e.totalAdvances)} of advances are pending`);
    const cash = gross - deduct;
    if (!confirm(`Pay ${e.name} for ${month}?\n\nGross: ₹${gross.toLocaleString('en-IN')}\nAdvance recovered: ₹${deduct.toLocaleString('en-IN')}\nCash paid out: ₹${cash.toLocaleString('en-IN')}\n\nThis posts to the ledger and cannot be undone from here.`)) return;

    set(e.id, { busy: true });
    try {
      const res = await fetch('/api/manager/salary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: e.id, amountToPay: cash, deductAdvanceAmount: deduct, monthYear: month })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      toast.success(`Salary paid to ${e.name}`);
      set(e.id, { busy: false, done: true });
      load();
    } catch (err: any) {
      toast.error(err.message || 'Salary payout failed');
      set(e.id, { busy: false });
    }
  };

  if (loading && employees.length === 0) return <div className="text-gray-400">Loading employees...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-3xl font-bold"><span className="text-red-500">Salary</span> Payout</h2>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Salary month</label>
          <input type="month" className="input-field" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
      </div>

      <p className="text-sm text-gray-400">
        Each employee can be paid once per month. Advance recovery reduces the cash you pay out and is cleared against the oldest pending advances first.
      </p>

      <div className="space-y-4">
        {employees.map(e => {
          const r = rows[e.id];
          if (!r) return null;
          const net = (Number(r.gross) || 0) - (Number(r.deduct) || 0);
          return (
            <div key={e.id} className="card grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
              <div className="md:col-span-2">
                <div className="font-bold text-white">{e.name}</div>
                <div className="text-xs text-gray-400">{e.role}</div>
                <div className="text-xs text-gray-400 mt-1">Pending advance: <span className={e.totalAdvances > 0 ? 'text-orange-400 font-bold' : ''}>{formatCurrency(e.totalAdvances)}</span></div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Gross salary (₹)</label>
                <input type="number" min="0" className="input-field" value={r.gross} onChange={ev => set(e.id, { gross: ev.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Recover advance (₹)</label>
                <input type="number" min="0" max={e.totalAdvances} className="input-field" value={r.deduct} onChange={ev => set(e.id, { deduct: ev.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Cash to pay</label>
                <div className="h-10 flex items-center font-mono font-bold text-green-400">₹{net.toLocaleString('en-IN')}</div>
              </div>
              <button className="btn-primary h-10" disabled={r.busy || r.done} onClick={() => pay(e)}>
                {r.done ? 'Paid ✓' : r.busy ? 'Paying...' : 'Pay salary'}
              </button>
            </div>
          );
        })}
        {employees.length === 0 && <div className="text-gray-400">No employees found.</div>}
      </div>
    </div>
  );
}
