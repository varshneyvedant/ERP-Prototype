'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

type Receipt = {
  id: string;
  date: string;
  materialType: string;
  supplierName: string;
  vehicleNo: string;
  challanWeight: number;
  actualWeight: number;
  shortage: number;
  notes: string;
};

export default function GateReceiptPage() {
  const [materialType, setMaterialType] = useState('COPPER');
  const [supplierName, setSupplierName] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [challanWeight, setChallanWeight] = useState('');
  const [actualWeight, setActualWeight] = useState('');
  const [notes, setNotes] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  const loadReceipts = async () => {
    try {
      const res = await fetch('/api/manager/gate-receipt');
      const data = await res.json();
      if (data.receipts) setReceipts(data.receipts);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadReceipts(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/manager/gate-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialType, supplierName, vehicleNo,
          challanWeight: Number(challanWeight),
          actualWeight: Number(actualWeight),
          notes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Gate Receipt logged!');
      setSupplierName('');
      setVehicleNo('');
      setChallanWeight('');
      setActualWeight('');
      setNotes('');
      loadReceipts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to log receipt');
    } finally {
      setLoading(false);
    }
  };

  const shortageNum = (Number(challanWeight) || 0) - (Number(actualWeight) || 0);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <span className="text-red-500">Gate</span> Receipt (Weighbridge)
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Log all incoming trucks. Enter the weight printed on the supplier's challan and the actual weight you measured on the factory weighbridge.
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Material Type</label>
              <select className="input-field" value={materialType} onChange={e => setMaterialType(e.target.value)}>
                <option value="COPPER">Raw Copper</option>
                <option value="PVC">PVC / Plastic</option>
                <option value="PACKAGING">Packaging Material</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Supplier Name</label>
              <input type="text" required className="input-field" value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="e.g. ABC Metals" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Vehicle No. (Truck)</label>
              <input type="text" required className="input-field" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} placeholder="e.g. HR 38 X 1234" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-black/20 rounded-lg">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Challan Weight (Kg)</label>
              <input type="number" step="0.1" required className="input-field font-mono" value={challanWeight} onChange={e => setChallanWeight(e.target.value)} placeholder="Weight on bill" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Actual Weighbridge Weight (Kg)</label>
              <input type="number" step="0.1" required className="input-field font-mono" value={actualWeight} onChange={e => setActualWeight(e.target.value)} placeholder="Physical weight" />
            </div>
          </div>

          {challanWeight && actualWeight && (
            <div className={`p-4 rounded-lg \${shortageNum > 0 ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-green-500/10 text-green-500 border border-green-500/20'}`}>
              <strong>Shortage: </strong> {shortageNum.toFixed(1)} Kg
              {shortageNum > 0 && <span className="ml-2 text-sm">(We received LESS than billed!)</span>}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Notes</label>
            <input type="text" className="input-field" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any issues with quality or packaging?" />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Logging...' : 'Log Gate Receipt'}
          </button>
        </form>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-bold">Recent Inwards</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="pb-3">Date</th>
                <th className="pb-3">Material</th>
                <th className="pb-3">Supplier & Vehicle</th>
                <th className="pb-3 text-right">Challan (Kg)</th>
                <th className="pb-3 text-right">Actual (Kg)</th>
                <th className="pb-3 text-right">Shortage</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => (
                <tr key={r.id} className="border-b border-gray-800/50 hover:bg-white/5">
                  <td className="py-3">{new Date(r.date).toLocaleString('en-IN')}</td>
                  <td className="py-3 font-medium">{r.materialType}</td>
                  <td className="py-3">
                    <div>{r.supplierName}</div>
                    <div className="text-xs text-gray-500">{r.vehicleNo}</div>
                  </td>
                  <td className="py-3 text-right font-mono">{Number(r.challanWeight).toFixed(1)}</td>
                  <td className="py-3 text-right font-mono">{Number(r.actualWeight).toFixed(1)}</td>
                  <td className={`py-3 text-right font-mono font-bold \${Number(r.shortage) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {Number(r.shortage).toFixed(1)}
                  </td>
                </tr>
              ))}
              {receipts.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-gray-500">No gate receipts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
