'use client';

import { useState, useEffect } from 'react';
import { FileText, Download, ShieldCheck, RefreshCw } from 'lucide-react';
import { formatCurrency, formatDateIST } from '@/lib/format';
import { exportToExcel } from '@/lib/export/excel';
import { exportToPDF } from '@/lib/export/pdf';

export default function JournalsPage() {
  const [journals, setJournals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRefType, setFilterRefType] = useState<string>('ALL');

  const fetchJournals = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/owner/journals');
      const data = await res.json();
      if (data.journals) {
        setJournals(data.journals);
      }
    } catch (err) {
      console.error('Failed to fetch journal entries:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJournals();
  }, []);

  const filteredJournals = filterRefType === 'ALL'
    ? journals
    : journals.filter(j => j.referenceType === filterRefType);

  // Export handlers
  const handleExportExcel = () => {
    // Flatten journals lines into rows
    const data: any[] = [];
    filteredJournals.forEach(j => {
      j.lines.forEach((l: any, idx: number) => {
        data.push({
          'Journal Date': formatDateIST(j.date),
          'Journal Entry ID': j.id,
          'Description': idx === 0 ? j.description : '',
          'Reference Type': idx === 0 ? j.referenceType || '-' : '',
          'Reference ID': idx === 0 ? j.referenceId || '-' : '',
          'GL Account Name': l.accountName,
          'Account Type': l.accountType,
          'Debit (₹)': Number(l.debit) > 0 ? Number(l.debit) : '',
          'Credit (₹)': Number(l.credit) > 0 ? Number(l.credit) : ''
        });
      });
    });
    exportToExcel(data, 'General_Ledger_Journals');
  };

  const handleExportPDF = () => {
    const headers = ['Date', 'Entry Details & GL Accounts', 'Reference', 'Debit', 'Credit'];
    const rows: any[][] = [];

    filteredJournals.forEach(j => {
      // Main header row of entry
      rows.push([
        formatDateIST(j.date),
        `ENTRY ID: ${j.id}\n${j.description}`,
        `${j.referenceType || '-'}\n${j.referenceId || '-'}`,
        '',
        ''
      ]);
      // Line items
      j.lines.forEach((l: any) => {
        rows.push([
          '',
          `   • ${l.accountName} (${l.accountType})`,
          '',
          Number(l.debit) > 0 ? formatCurrency(Number(l.debit)) : '-',
          Number(l.credit) > 0 ? formatCurrency(Number(l.credit)) : '-'
        ]);
      });
    });

    exportToPDF(headers, rows, 'Manufacturing Company - General Ledger Journals');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="text-red-500" /> General Ledger GL
          </h2>
          <p className="text-gray-400 text-sm mt-1">Immutable Double-Entry Bookkeeping Audit Log</p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={fetchJournals}
            className="p-2 bg-[#2a2a2a] hover:bg-[#333] text-gray-300 rounded border border-[#333] transition-colors"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleExportExcel}
            disabled={filteredJournals.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-green-950/40 hover:bg-green-900/60 border border-green-500/20 text-green-400 rounded transition-colors"
          >
            <Download size={16} /> Excel
          </button>
          <button
            onClick={handleExportPDF}
            disabled={filteredJournals.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-red-950/40 hover:bg-red-900/60 border border-red-500/20 text-red-400 rounded transition-colors"
          >
            <Download size={16} /> PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center bg-[#1a1a1a] p-4 rounded border border-[#333]">
        <span className="text-sm font-bold text-gray-400">Filter Reference Type:</span>
        <select
          value={filterRefType}
          onChange={e => setFilterRefType(e.target.value)}
          className="bg-[#222] border border-[#333] rounded px-3 py-1.5 text-sm font-semibold outline-none cursor-pointer hover:border-red-500/50"
        >
          <option value="ALL">Show All Entries</option>
          <option value="SALE">Sales Invoices</option>
          <option value="PURCHASE">Copper Purchases</option>
          <option value="PAYMENT">Payments (Approved)</option>
          <option value="EXPENSE">Factory Expenses</option>
          <option value="ADVANCE">Employee Advances</option>
          <option value="CREDIT_NOTE">Sales Returns (Credit Notes)</option>
          <option value="DEBIT_NOTE">Supplier Returns (Debit Notes)</option>
          <option value="PRODUCTION">Production Runs</option>
        </select>
        
        <div className="ml-auto text-xs text-gray-400 flex items-center gap-1">
          <ShieldCheck size={14} className="text-red-500" /> Continuous Auto-balancing Audit active
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 py-12 text-center text-sm">Querying General Ledger Journal Entry logs...</div>
      ) : filteredJournals.length === 0 ? (
        <div className="card text-gray-400 py-12 text-center italic text-sm border border-dashed border-[#333]">
          No General Ledger journal entries matched this filter.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredJournals.map((journal) => {
            const lines = journal.lines || [];
            const deb = lines.reduce((sum: number, l: any) => sum + Number(l.debit), 0);
            const cred = lines.reduce((sum: number, l: any) => sum + Number(l.credit), 0);

            return (
              <div key={journal.id} className="card bg-[#141414] border border-[#333] hover:border-red-500/20 transition-all p-5">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 pb-3 border-b border-[#333]/50">
                  <div>
                    <span className="text-[10px] text-gray-400 font-mono tracking-wider uppercase block">Entry ID: {journal.id}</span>
                    <h4 className="text-base font-bold text-white mt-0.5">{journal.description}</h4>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-gray-400 font-medium">{formatDateIST(journal.date)}</span>
                    {journal.referenceType && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-[#222] border border-[#333] text-gray-400">
                        Ref: {journal.referenceType} ({journal.referenceId?.slice(0, 8)})
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-gray-400 uppercase font-black tracking-wider border-b border-[#333]/30">
                        <th className="py-2 pl-2">GL Account Name</th>
                        <th className="py-2">Category</th>
                        <th className="py-2 text-right">Debit (Dr.)</th>
                        <th className="py-2 pr-2 text-right">Credit (Cr.)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line: any) => (
                        <tr key={line.id} className="border-b border-[#333]/10 last:border-0 hover:bg-[#1a1a1a]/50">
                          <td className={`py-2 pl-2 font-bold ${Number(line.debit) > 0 ? 'text-white pl-2' : 'text-gray-400 pl-6'}`}>
                            {line.accountName}
                          </td>
                          <td className="py-2 text-gray-400">{line.accountType}</td>
                          <td className="py-2 text-right font-black text-sm text-green-400">
                            {Number(line.debit) > 0 ? formatCurrency(Number(line.debit)) : '-'}
                          </td>
                          <td className="py-2 pr-2 text-right font-black text-sm text-red-400">
                            {Number(line.credit) > 0 ? formatCurrency(Number(line.credit)) : '-'}
                          </td>
                        </tr>
                      ))}
                      
                      {/* Total balancing check */}
                      <tr className="border-t-2 border-double border-[#333] bg-[#1a1a1a]/20">
                        <td className="py-2 pl-2 font-black text-gray-400 uppercase italic">Balanced Total</td>
                        <td className="py-2"></td>
                        <td className="py-2 text-right font-black text-sm text-green-400 border-b border-green-500/50">
                          {formatCurrency(deb)}
                        </td>
                        <td className="py-2 pr-2 text-right font-black text-sm text-red-400 border-b border-red-500/50">
                          {formatCurrency(cred)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
