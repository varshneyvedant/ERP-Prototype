'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/format';
import { useRouter } from 'next/navigation';

export default function DayClosePage() {
  const [physicalCash, setPhysicalCash] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!physicalCash || isNaN(Number(physicalCash))) return toast.error('Enter valid physical cash amount');
    
    if (!confirm('Are you sure you want to lock in the Day Close? This action is logged permanently and alerts the owner of any discrepancies.')) return;

    setLoading(true);
    try {
      const res = await fetch('/api/manager/day-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physicalCash: Number(physicalCash), notes })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setResult(data.data);
      toast.success('Day close logged successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to log day close');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="max-w-xl mx-auto mt-10 p-6 card space-y-6 text-center">
        <h2 className="text-2xl font-bold text-white">Day Close Complete</h2>
        
        <div className="grid grid-cols-2 gap-4 text-left">
          <div className="p-4 bg-black/20 rounded-lg">
            <div className="text-sm text-gray-400">Physical Cash Counted</div>
            <div className="text-xl font-mono text-white">{formatCurrency(result.declaredCash)}</div>
          </div>
          <div className="p-4 bg-black/20 rounded-lg">
            <div className="text-sm text-gray-400">System Expected Cash</div>
            <div className="text-xl font-mono text-white">{formatCurrency(result.systemCash)}</div>
          </div>
        </div>

        <div className={`p-6 rounded-lg border \${result.discrepancy === 0 ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
           <h3 className="text-lg mb-2">Discrepancy</h3>
           <div className="text-3xl font-mono font-bold">
             {result.discrepancy > 0 ? '+' : ''}{formatCurrency(result.discrepancy)}
           </div>
           {result.discrepancy !== 0 && (
             <p className="text-sm mt-2">
               {result.discrepancy < 0 ? 'Cash is SHORT. ' : 'Cash is OVER. '} 
               The owner has been notified.
             </p>
           )}
        </div>

        <button onClick={() => router.push('/manager/dashboard')} className="btn-primary w-full">
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto mt-10">
      <div className="card space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <span className="text-red-500">Day</span> Close
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Count the physical cash in the drawer and enter it here. This must match the system's calculated balance.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Physical Cash in Drawer (,1)</label>
            <input 
              type="number" 
              required 
              min="0"
              step="0.01"
              className="input-field text-2xl font-mono"
              placeholder="0.00"
              value={physicalCash}
              onChange={e => setPhysicalCash(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Notes / Explanations for discrepancy (Optional)</label>
            <textarea 
              className="input-field min-h-[100px]"
              placeholder="If you know why the cash might not match, explain it here..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-lg font-bold">
            {loading ? 'Submitting...' : 'Submit Day Close'}
          </button>
        </form>
      </div>
    </div>
  );
}
