'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { 
  TrendingUp, Banknote, CreditCard, Factory, 
  ArrowUpRight, ShieldCheck, ClipboardList, RefreshCw, 
  Activity, ArrowRight, RotateCcw 
} from 'lucide-react';
import Link from 'next/link';
import AlertsPanel from '@/components/AlertsPanel';
import { useState } from 'react';
import { formatCurrency, formatDateIST } from '@/lib/format';

export default function OwnerDashboard() {
  const router = useRouter();
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  const { data: queryData, isLoading, refetch } = useQuery({
    queryKey: ['ownerDashboard'],
    queryFn: async () => {
      const res = await fetch('/api/owner/dashboard');
      if (!res.ok) throw new Error('Failed to fetch dashboard data');
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 1000 * 45 // Refresh every 45 seconds
  });

  const data = queryData;

  const handleRollback = async (logId: string) => {
    if (!confirm("Are you absolutely sure you want to rollback and reverse this action? This will undo the creation of the record in the database.")) return;
    setRollingBackId(logId);
    try {
      const res = await fetch('/api/owner/audit/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId })
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || "Rollback failed");
      } else {
        alert("Rollback successful! The transaction has been reversed.");
        refetch();
      }
    } catch (err) {
      console.error(err);
      alert("An unexpected error occurred.");
    } finally {
      setRollingBackId(null);
    }
  };

  const handleAuthorizePayment = async (paymentId: string, action: 'APPROVE' | 'REJECT') => {
    const actionStr = action === 'APPROVE' ? 'Approve' : 'Reject';
    if (!confirm(`Are you sure you want to ${actionStr} this stakeholder payment?`)) return;

    try {
      const res = await fetch('/api/owner/payments/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, action })
      });
      const json = await res.json();
      if (res.ok) {
        alert(`Successfully ${action === 'APPROVE' ? 'approved' : 'rejected'} payment!`);
        refetch();
      } else {
        alert(json.error || 'Authorization failed');
      }
    } catch (err) {
      console.error(err);
      alert('An unexpected error occurred.');
    }
  };

  const getIsRollbackable = (log: any) => {
    if (log.action !== 'CREATE') return false;
    try {
      if (!log.details) return false;
      const details = JSON.parse(log.details);
      return !!details.id;
    } catch {
      return false;
    }
  };

  const getActionColor = (action: string) => {
    switch(action) {
      case 'CREATE': return 'text-green-500 bg-green-950/40 border-green-500/20';
      case 'UPDATE': return 'text-blue-500 bg-blue-950/40 border-blue-500/20';
      case 'DELETE': return 'text-red-500 bg-red-950/40 border-red-500/20';
      default: return 'text-gray-400 bg-gray-800 border-gray-700';
    }
  };

  return (
    <div className="max-w-7xl 2xl:max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
            Owner <span className="text-red-500">Executive</span> Command Center
          </h2>
          <p className="text-gray-400 text-xs sm:text-sm mt-1">High-level financial surveillance & factory operational control</p>
        </div>
        <button 
          onClick={() => refetch()} 
          className="flex items-center gap-2 bg-[#2a2a2a] hover:bg-[#333] text-gray-300 font-semibold py-2 px-4 rounded-lg border border-[#333] transition-colors text-sm"
        >
          <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <AlertsPanel />

      {isLoading ? (
        <div className="text-gray-400 p-8 card text-center">Loading executive command dashboard...</div>
      ) : (
        <>
          {/* Low Raw Copper Critical Stock Alert */}
          {data?.operations?.isRawCopperLow && (
            <div className="p-4 bg-red-950/40 border-2 border-red-500 rounded-xl flex items-center justify-between gap-4 animate-pulse">
              <div className="flex items-center gap-3">
                <span className="text-3xl">⚠️</span>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-red-400 uppercase tracking-wide">
                    Executive Alert: Raw Copper Below 5.00 Tons!
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-300">
                    Current warehouse raw copper is <strong>{Number(data?.operations?.rawCopperStock || 0).toFixed(2)} Tons</strong>. Reorder immediately to prevent plant shutdown.
                  </p>
                </div>
              </div>
              <Link href="/manager/purchase" className="py-2 px-4 bg-red-600 hover:bg-red-700 font-bold text-xs sm:text-sm rounded-lg whitespace-nowrap text-white">
                + Purchase Copper
              </Link>
            </div>
          )}

          {/* Low Finished Goods Alert */}
          {data?.operations?.lowFinishedGoodsAlerts && data.operations.lowFinishedGoodsAlerts.length > 0 && (
            <div className="p-4 bg-orange-950/30 border border-orange-500/50 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-orange-400 uppercase tracking-wider flex items-center gap-2">
                  <span>🔔</span> Finished Goods Below Minimum Safety Stock (&lt; 500 Kg)
                </h4>
                <Link href="/shared/inventory/finished" className="text-xs text-orange-300 hover:underline font-semibold">
                  View Warehouse Stock →
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.operations.lowFinishedGoodsAlerts.map((item: any, idx: number) => (
                  <span key={idx} className="bg-[#1e1e1e] border border-orange-500/30 text-orange-300 px-2.5 py-1 rounded-md text-xs font-bold">
                    {item.brand} {item.wireType} ({item.productCategory}): <span className="text-white font-mono">{Number(item.totalStock).toFixed(2)}T</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pending Payment Authorizations (Dual-Authorization) - MOVED TO TOP FOR MOBILE ERGONOMICS */}
          {data?.pendingPayments && data.pendingPayments.length > 0 && (
             <div className="card border-t-2 border-t-yellow-500 bg-[#1a1a1a]/90 backdrop-blur-md">
                <div className="flex justify-between items-center mb-4 border-b border-[#333] pb-3">
                   <h3 className="text-base sm:text-lg text-yellow-500 font-bold flex items-center gap-2">
                     <RotateCcw className="text-yellow-500" size={18} /> Pending Payment Authorizations
                   </h3>
                   <span className="px-2.5 py-0.5 bg-yellow-950/50 text-yellow-400 border border-yellow-500/30 text-xs font-black rounded-full">
                      {data.pendingPayments.length} Action Needed
                   </span>
                </div>

                {/* Mobile Cards View (< 640px) */}
                <div className="sm:hidden space-y-3">
                  {data.pendingPayments.map((p: any) => (
                    <div key={p.id} className="p-3.5 bg-[#222] rounded-lg border border-[#333] space-y-2.5">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-bold text-white text-sm block">
                            {p.customer?.name || p.supplier?.name || 'Unknown Party'}
                          </span>
                          <span className="text-[11px] text-gray-400">{formatDateIST(p.date)}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${p.type === 'INCOMING' ? 'bg-green-950/40 text-green-400 border border-green-500/20' : 'bg-red-950/40 text-red-400 border border-red-500/20'}`}>
                          {p.type === 'INCOMING' ? 'Customer Paid' : 'We Paid'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center bg-[#1a1a1a] p-2 rounded border border-[#333]">
                        <span className="text-xs text-gray-400">Authorized Amount:</span>
                        <span className="font-bold text-white text-base tabular-nums">
                          {formatCurrency(Number(p.amount))}
                        </span>
                      </div>
                      {p.description && (
                        <p className="text-xs text-gray-400 italic">{p.description}</p>
                      )}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#333]">
                        <button
                          onClick={() => handleAuthorizePayment(p.id, 'APPROVE')}
                          className="py-2 bg-green-950/40 hover:bg-green-900/60 text-green-400 border border-green-500/30 text-xs rounded-lg font-black transition-all text-center min-h-[40px]"
                        >
                          Approve Payment
                        </button>
                        <button
                          onClick={() => handleAuthorizePayment(p.id, 'REJECT')}
                          className="py-2 bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-500/30 text-xs rounded-lg font-black transition-all text-center min-h-[40px]"
                        >
                          Reject Payment
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop/Tablet Table (>= 640px) */}
                <div className="hidden sm:block overflow-x-auto rounded-lg border border-[#333]">
                   <table className="w-full text-left text-sm">
                      <thead className="bg-[#222]">
                         <tr className="border-b border-[#333] text-gray-400 text-xs uppercase font-black">
                            <th className="p-3">Submitted At</th>
                            <th className="p-3">Type</th>
                            <th className="p-3">Stakeholder</th>
                            <th className="p-3">Amount</th>
                            <th className="p-3">Description</th>
                            <th className="p-3 text-right">Actions</th>
                         </tr>
                      </thead>
                      <tbody>
                         {data.pendingPayments.map((p: any) => (
                            <tr key={p.id} className="border-b border-[#333] last:border-0 hover:bg-[#252525] text-gray-300 transition-colors">
                               <td className="p-3 whitespace-nowrap text-xs text-gray-400">{formatDateIST(p.date)}</td>
                               <td className="p-3 whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${p.type === 'INCOMING' ? 'bg-green-950/40 text-green-400 border border-green-500/20' : 'bg-red-950/40 text-red-400 border border-red-500/20'}`}>
                                     {p.type === 'INCOMING' ? 'Customer Paid' : 'We Paid'}
                                  </span>
                               </td>
                               <td className="p-3 font-semibold text-white">
                                  {p.customer?.name || p.supplier?.name || '-'}
                                </td>
                               <td className="p-3 font-bold text-white text-base tabular-nums whitespace-nowrap">
                                  {formatCurrency(Number(p.amount))}
                               </td>
                               <td className="p-3 text-xs text-gray-400 max-w-xs truncate">{p.description || '-'}</td>
                               <td className="p-3 text-right whitespace-nowrap">
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={() => handleAuthorizePayment(p.id, 'APPROVE')}
                                      className="px-3 py-1 bg-green-950/30 hover:bg-green-900/60 text-green-400 border border-green-500/20 text-xs rounded font-black transition-all"
                                    >
                                       Approve
                                    </button>
                                    <button
                                      onClick={() => handleAuthorizePayment(p.id, 'REJECT')}
                                      className="px-3 py-1 bg-red-950/30 hover:bg-red-900/60 text-red-400 border border-red-500/20 text-xs rounded font-black transition-all"
                                    >
                                       Reject
                                    </button>
                                  </div>
                               </td>
                            </tr>
                         ))}
                      </tbody>
                   </table>
                </div>
             </div>
          )}

          {/* Quick Deep Dives Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
             <Link href="/owner/financials" className="card border border-[#333] hover:border-red-500/40 bg-[#1a1a1a] transition-all p-4 sm:p-5 flex flex-col justify-between group">
                <div>
                   <h3 className="text-gray-300 font-bold group-hover:text-red-400 transition-colors text-sm sm:text-base">Financial Dashboard</h3>
                   <p className="text-xs text-gray-400 mt-1">Detailed Revenue, Profit, and Expense analytics</p>
                </div>
                <div className="text-red-500 flex items-center gap-1 mt-4 text-xs font-semibold">
                   View Deep Dive <ArrowRight size={12}/>
                </div>
             </Link>
             <Link href="/owner/stakeholders" className="card border border-[#333] hover:border-blue-500/40 bg-[#1a1a1a] transition-all p-4 sm:p-5 flex flex-col justify-between group">
                <div>
                   <h3 className="text-gray-300 font-bold group-hover:text-blue-400 transition-colors text-sm sm:text-base">Stakeholders Ledger</h3>
                   <p className="text-xs text-gray-400 mt-1">Balances, wait-times, and payment histories</p>
                </div>
                <div className="text-blue-500 flex items-center gap-1 mt-4 text-xs font-semibold">
                   View Stakeholders <ArrowRight size={12}/>
                </div>
             </Link>
             <Link href="/owner/inventory" className="card border border-[#333] hover:border-yellow-500/40 bg-[#1a1a1a] transition-all p-4 sm:p-5 flex flex-col justify-between group">
                <div>
                   <h3 className="text-gray-300 font-bold group-hover:text-yellow-400 transition-colors text-sm sm:text-base">Raw Copper Analytics</h3>
                   <p className="text-xs text-gray-400 mt-1">Inventory lifespans, reorders, and yields</p>
                </div>
                <div className="text-yellow-500 flex items-center gap-1 mt-4 text-xs font-semibold">
                   View Stock Analytics <ArrowRight size={12}/>
                </div>
             </Link>
             <Link href="/owner/employees" className="card border border-[#333] hover:border-purple-500/40 bg-[#1a1a1a] transition-all p-4 sm:p-5 flex flex-col justify-between group">
                <div>
                   <h3 className="text-gray-300 font-bold group-hover:text-purple-400 transition-colors text-sm sm:text-base">HR & Payroll</h3>
                   <p className="text-xs text-gray-400 mt-1">Manage staff wages, audit adjustments, and salary scales</p>
                </div>
                <div className="text-purple-500 flex items-center gap-1 mt-4 text-xs font-semibold">
                   Manage Employees <ArrowRight size={12}/>
                </div>
             </Link>
          </div>

          {/* KPI Panels Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             {/* Financial Panel */}
             <div className="space-y-3">
                <h3 className="text-base sm:text-lg font-bold text-gray-300 flex items-center gap-2">
                   <Banknote className="text-emerald-500" /> Current Financial Position
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                   <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] border-l-4 border-l-green-500">
                      <div className="text-gray-400 text-xs mb-1">Receivables (Owed to Us)</div>
                      <div className="text-xl sm:text-2xl font-bold text-white tabular-nums whitespace-nowrap">{formatCurrency(data?.financials?.totalReceivables || 0)}</div>
                   </div>
                   <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] border-l-4 border-l-red-500">
                      <div className="text-gray-400 text-xs mb-1">Payables (We Owe)</div>
                      <div className="text-xl sm:text-2xl font-bold text-white tabular-nums whitespace-nowrap">{formatCurrency(data?.financials?.totalPayables || 0)}</div>
                   </div>
                   <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] border-l-4 border-l-blue-500">
                      <div className="text-gray-400 text-xs mb-1">Net Position</div>
                      <div className="text-xl sm:text-2xl font-bold text-blue-400 tabular-nums whitespace-nowrap">{formatCurrency(data?.financials?.netAmount || 0)}</div>
                   </div>
                   <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] border-l-4 border-l-emerald-500 bg-emerald-950/10">
                      <div className="text-gray-400 text-xs mb-1">Cash in Hand</div>
                      <div className="text-xl sm:text-2xl font-bold text-emerald-400 tabular-nums whitespace-nowrap">{formatCurrency(data?.financials?.cashInHand || 0)}</div>
                   </div>
                </div>
             </div>

             {/* Floor Operations Panel */}
             <div className="space-y-3">
                <h3 className="text-base sm:text-lg font-bold text-gray-300 flex items-center gap-2">
                   <Factory className="text-yellow-500" /> Live Floor Operations
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                   <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333]">
                      <div className="text-gray-400 text-xs mb-1">Raw Copper Stock</div>
                      <div className="text-xl sm:text-2xl font-bold text-white tabular-nums whitespace-nowrap">{Number(data?.operations?.rawCopperStock || 0).toFixed(2)} Tons</div>
                   </div>
                   <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333]">
                      <div className="text-gray-400 text-xs mb-1">Wire Output Today</div>
                      <div className="text-xl sm:text-2xl font-bold text-white tabular-nums whitespace-nowrap">{Number(data?.operations?.productionToday || 0).toFixed(2)} Tons</div>
                   </div>
                   <div className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] sm:col-span-2">
                      <div className="text-gray-400 text-xs mb-1">30D Rolling Production Yield</div>
                      <div className="flex justify-between items-center mt-1">
                         <div className={`text-xl sm:text-2xl font-bold tabular-nums ${Number(data?.operations?.yield30Days || 0) >= 95 ? 'text-green-500' : 'text-red-500'}`}>
                            {Number(data?.operations?.yield30Days || 0).toFixed(2)}%
                         </div>
                         <span className="text-[10px] text-gray-400 font-semibold uppercase">Target: 95%+</span>
                      </div>
                   </div>
                </div>
             </div>
          </div>

          {/* Recent Audit Trails */}
          <div className="card">
             <div className="flex justify-between items-center mb-4 border-b border-[#333] pb-3">
                <h3 className="text-base sm:text-lg text-gray-300 font-bold flex items-center gap-2">
                  <Activity className="text-purple-500" /> Recent System Activities
                </h3>
                <Link href="/owner/audit" className="text-xs text-red-500 hover:text-red-400 font-bold flex items-center gap-1">
                   View Full Logs <ArrowRight size={12}/>
                </Link>
             </div>

             {/* Mobile Audit Cards (< 640px) */}
             <div className="sm:hidden space-y-2.5">
                {data?.recentAudits?.map((log: any) => (
                   <div key={log.id} className="p-3 bg-[#222] rounded-lg border border-[#333] space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                         <span className="text-gray-400">{formatDateIST(log.date)}</span>
                         <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${getActionColor(log.action)}`}>
                            {log.action}
                         </span>
                      </div>
                      <div className="flex justify-between items-center">
                         <span className="font-semibold text-white">{log.module}</span>
                         <span className={`px-2 py-0.5 rounded text-[10px] font-black ${log.user === 'OWNER' ? 'bg-red-950/40 text-red-400' : 'bg-blue-950/40 text-blue-400'}`}>
                            {log.user}
                         </span>
                      </div>
                      <p className="text-gray-300">{log.description}</p>
                      {getIsRollbackable(log) && (
                         <div className="pt-2 border-t border-[#333] flex justify-end">
                            <button
                              disabled={rollingBackId === log.id}
                              onClick={() => handleRollback(log.id)}
                              className="w-full py-1.5 bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-500/20 text-xs rounded font-black transition-all flex items-center justify-center gap-1"
                            >
                               <RotateCcw size={12} className={rollingBackId === log.id ? "animate-spin" : ""} />
                               Rollback Action
                            </button>
                         </div>
                      )}
                   </div>
                ))}
                {(!data?.recentAudits || data.recentAudits.length === 0) && (
                   <div className="p-4 text-center text-gray-400">No recent activities found.</div>
                )}
             </div>

             {/* Desktop/Tablet Table (>= 640px) */}
             <div className="hidden sm:block overflow-x-auto rounded-lg border border-[#333]">
                <table className="w-full text-left text-sm">
                   <thead className="bg-[#222]">
                      <tr className="border-b border-[#333] text-gray-400 text-xs uppercase">
                         <th className="p-3">Timestamp</th>
                         <th className="p-3">User</th>
                         <th className="p-3">Module</th>
                         <th className="p-3">Action</th>
                         <th className="p-3">Description</th>
                         <th className="p-3 text-right">Overrides</th>
                      </tr>
                   </thead>
                   <tbody>
                      {data?.recentAudits?.map((log: any) => (
                         <tr key={log.id} className="border-b border-[#333] last:border-0 hover:bg-[#2a2a2a] text-sm text-gray-300 transition-colors">
                            <td className="p-3 whitespace-nowrap text-gray-400">{formatDateIST(log.date)}</td>
                            <td className="p-3">
                               <span className={`px-2 py-0.5 rounded text-[10px] font-black ${log.user === 'OWNER' ? 'bg-red-950/40 text-red-400' : 'bg-blue-950/40 text-blue-400'}`}>
                                  {log.user}
                               </span>
                            </td>
                            <td className="p-3 font-semibold text-white whitespace-nowrap">{log.module}</td>
                            <td className="p-3 whitespace-nowrap">
                               <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${getActionColor(log.action)}`}>
                                  {log.action}
                               </span>
                            </td>
                            <td className="p-3 text-xs">{log.description}</td>
                            <td className="p-3 text-right whitespace-nowrap">
                               {getIsRollbackable(log) ? (
                                  <button
                                    disabled={rollingBackId === log.id}
                                    onClick={() => handleRollback(log.id)}
                                    className="px-2 py-0.5 bg-red-950/30 hover:bg-red-900/50 text-red-500 border border-red-500/20 text-[10px] rounded transition-all flex items-center gap-1 font-black ml-auto"
                                  >
                                     <RotateCcw size={10} className={rollingBackId === log.id ? "animate-spin" : ""} />
                                     Rollback
                                  </button>
                               ) : (
                                  <span className="text-[10px] text-gray-600 font-medium italic">Immutable</span>
                                )}
                            </td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>
          </div>
        </>
      )}
    </div>
  );
}
