'use client';

import { formatDateIST } from '@/lib/format';
import { useState, useEffect, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import TimeframeSelector from '@/components/ui/TimeframeSelector';
import { Timeframe } from '@/lib/timeframe';
import { Building, Phone, MapPin, Truck, FileText, Star, Clock, ArrowLeft, Share2, Download, PieChart as PieChartIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { exportToPDF } from '@/lib/export/pdf';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];

function CustomerDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const initialTimeframe = (searchParams.get('timeframe') as Timeframe) || '1M';
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);

  const handleTimeframeChange = (newTf: Timeframe) => {
     setTimeframe(newTf);
     router.replace(`/owner/stakeholders/customer/${id}?timeframe=${newTf}`);
  };

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const fetchData = async () => {
      try {
        const res = await fetch(`/api/owner/stakeholders/customer?id=${id}&timeframe=${timeframe}`);
        const json = await res.json();
        if (isMounted) setData(json.data);
      } catch (error) {
        console.error(error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    return () => { isMounted = false; };
  }, [id, timeframe]);

  const handleSendKhataWhatsApp = () => {
    if (!data) return;
    const cust = data.customer;
    const metrics = data.metrics;
    
    const rawPhone = cust.contact || '';
    let cleanedPhone = rawPhone.replace(/\D/g, '');
    if (cleanedPhone.startsWith('91') && cleanedPhone.length === 12) {
      // correct
    } else if (cleanedPhone.length === 10) {
      cleanedPhone = '91' + cleanedPhone;
    } else if (cleanedPhone.startsWith('0') && cleanedPhone.length === 11) {
      cleanedPhone = '91' + cleanedPhone.slice(1);
    }

    const msg = `Net Balance: ₹${metrics.pendingAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

    const waUrl = `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
  };

  if (loading && !data) return <div className="text-gray-400">Loading customer profile...</div>;

  return (
    <div className="max-w-7xl 2xl:max-w-[1600px] mx-auto space-y-6 pb-20">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-2 bg-[#2a2a2a] px-3 py-1 rounded w-fit text-sm"
      >
        <ArrowLeft size={16} /> Back to Directory
      </button>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#1a1a1a] p-5 rounded-xl border border-[#333]">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold mb-2 flex items-center gap-2 text-white">
            <Building className="text-red-500" /> {data?.customer.name}
          </h2>
          <div className="text-gray-400 text-xs sm:text-sm flex flex-wrap gap-x-4 gap-y-1">
             <span className="flex items-center gap-1"><Phone size={14}/> {data?.customer.contact || 'N/A'}</span>
             <span className="flex items-center gap-1"><FileText size={14}/> GST: {data?.customer.gst || 'N/A'}</span>
             <span className="flex items-center gap-1"><Truck size={14}/> {data?.customer.transport || 'N/A'}</span>
          </div>
          <div className="text-gray-400 text-xs sm:text-sm mt-1 flex items-center gap-1">
             <MapPin size={14} /> {data?.customer.address || 'N/A'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={handleSendKhataWhatsApp}
            className="btn-primary bg-emerald-600 hover:bg-emerald-700 font-bold text-xs sm:text-sm flex items-center gap-1.5 flex-1 md:flex-initial"
          >
            <Share2 size={16} /> Send Khata on WhatsApp
          </button>
          <button
            onClick={() => {
              const headers = ['Date', 'Invoice / Details', 'Total Amount', 'Payment Status'];
              const rows = data.salesHistory.map((s: any) => [
                formatDateIST(s.date),
                s.items.map((i: any) => `${i.productCategory} (${Number(i.qty).toFixed(2)}T)`).join(', '),
                `₹ ${s.totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                s.isFullyPaid ? 'PAID' : `Pending ₹ ${s.pendingAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
              ]);
              exportToPDF(headers, rows, `Customer_Statement_${data.customer.name}`);
            }}
            className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] text-white border border-[#444] rounded font-bold text-xs sm:text-sm flex items-center gap-1.5"
          >
            <Download size={14} /> Statement PDF
          </button>
          <TimeframeSelector value={timeframe} onChange={handleTimeframeChange} />
        </div>
      </div>

      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card border-l-4 border-l-blue-500 bg-[#1a1a1a]">
              <div className="text-gray-400 text-xs mb-1">Company Revenue Share</div>
              <div className="text-2xl sm:text-3xl font-black text-white tabular-nums">{Number(data.metrics.revenuePercent).toFixed(1)}%</div>
              <div className="text-[11px] text-gray-400 mt-1">in selected timeframe</div>
            </div>
            <div className="card border-l-4 border-l-orange-500 bg-[#1a1a1a]">
              <div className="text-gray-400 text-xs mb-1">Total Sales Value</div>
              <div className="text-2xl sm:text-3xl font-black text-white tabular-nums">{formatCurrency(data.metrics.totalSalesValue)}</div>
              <div className="text-[11px] text-gray-400 mt-1">{Number(data.metrics.totalTons).toFixed(2)} Tons ordered</div>
            </div>
            <div className="card border-l-4 border-l-red-500 bg-[#1a1a1a]">
              <div className="text-gray-400 text-xs mb-1">Net Outstanding Balance</div>
              <div className={`text-2xl sm:text-3xl font-black tabular-nums ${data.metrics.pendingAmount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {formatCurrency(data.metrics.pendingAmount)}
              </div>
              <div className="text-[11px] text-gray-400 mt-1">Current unpaid balance</div>
            </div>
            <div className="card bg-gradient-to-br from-[#1e1e1e] to-[#2a2a2a] border-l-4 border-l-yellow-500">
              <div className="text-gray-400 text-xs mb-1">Customer Classification</div>
              <div className="text-xl sm:text-2xl font-black text-yellow-400 flex items-center gap-1.5">
                <Star size={18} /> {data.metrics.rank}
              </div>
              <div className="text-[11px] text-gray-400 mt-1">Avg cycle: {data.metrics.paymentCycle.averageDays.toFixed(0)} Days</div>
            </div>
            </div>

          <div className="card bg-[#1a1a1a] p-4 sm:p-6 mb-6">
            <h3 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2 text-white">
              <PieChartIcon className="text-red-500" /> Customer Janam Kundli (Ordering Habits)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 h-64">
               <div className="h-full">
                  <h4 className="text-center text-sm text-gray-400 mb-2">Volume by Category (Tons)</h4>
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie data={data.janamKundli.categories} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60}>
                           {data.janamKundli.categories.map((_: any, index: number) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <RechartsTooltip contentStyle={{backgroundColor: '#1e1e1e', borderColor: '#333'}} formatter={(val: any) => `${Number(val).toFixed(2)} Tons`} />
                        <Legend wrapperStyle={{fontSize: '12px'}}/>
                     </PieChart>
                  </ResponsiveContainer>
               </div>

               <div className="h-full border-l border-r border-[#333]">
                  <h4 className="text-center text-sm text-gray-400 mb-2">Volume by Brand (Tons)</h4>
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie data={data.janamKundli.brands} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60}>
                           {data.janamKundli.brands.map((_: any, index: number) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <RechartsTooltip contentStyle={{backgroundColor: '#1e1e1e', borderColor: '#333'}} formatter={(val: any) => `${Number(val).toFixed(2)} Tons`} />
                        <Legend wrapperStyle={{fontSize: '12px'}}/>
                     </PieChart>
                  </ResponsiveContainer>
               </div>

               <div className="h-full">
                  <h4 className="text-center text-sm text-gray-400 mb-2">Volume by Wire Size (Tons)</h4>
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie data={data.janamKundli.sizes} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60}>
                           {data.janamKundli.sizes.map((_: any, index: number) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <RechartsTooltip contentStyle={{backgroundColor: '#1e1e1e', borderColor: '#333'}} formatter={(val: any) => `${Number(val).toFixed(2)} Tons`} />
                        <Legend wrapperStyle={{fontSize: '12px'}}/>
                     </PieChart>
                  </ResponsiveContainer>
               </div>
            </div>
            {data.janamKundli.categories.length === 0 && <div className="text-center text-gray-500 mt-4">No data available to generate Kundli.</div>}
          </div>

          <div className="card bg-[#1a1a1a] p-4 sm:p-6">
            <h3 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2 text-white">
              <Clock className="text-red-500" /> Order History ({timeframe})
            </h3>
            <div className="overflow-x-auto rounded-lg border border-[#333] mb-8">
              <table className="w-full text-left">
                <thead className="bg-[#222]">
                  <tr className="border-b border-[#333] text-gray-400 text-xs uppercase">
                    <th className="p-3">Date</th>
                    <th className="p-3">Items</th>
                    <th className="p-3 text-right">Total Value</th>
                    <th className="p-3 text-right">Payment Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.salesHistory.map((sale: any) => (
                    <tr key={sale.id} className="border-b border-[#333] last:border-0 hover:bg-[#2a2a2a] text-sm">
                      <td className="p-3 text-gray-300 align-top whitespace-nowrap">{formatDateIST(sale.date)}</td>
                      <td className="p-3 text-gray-300">
                        <div className="flex flex-col gap-1">
                          {sale.items.map((i: any) => (
                             <div key={i.id} className="bg-[#141414] p-2 rounded border border-[#333] flex justify-between">
                               <span>
                                 <strong>{Number(i.qty).toFixed(2)}T</strong> of {i.productCategory}
                                 {i.brand && ` (${i.brand})`}
                                 {i.wireType && ` - ${i.wireType}`}
                               </span>
                               <span className="text-gray-400 text-xs mt-0.5">@ ₹{(i.pricePerTon / 1000).toLocaleString('en-IN', {maximumFractionDigits: 2})}/KG</span>
                             </div>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 font-bold text-white text-right align-top tabular-nums">{formatCurrency(sale.totalValue)}</td>
                      <td className="p-3 text-right align-top">
                        {sale.isFullyPaid ? (
                           <span className="bg-green-950/40 text-green-500 px-2 py-1 rounded text-xs font-bold border border-green-500/20">PAID IN FULL</span>
                        ) : (
                           <div className="flex flex-col items-end">
                              <span className="text-red-400 font-bold mb-1 tabular-nums">Pending: {formatCurrency(sale.pendingAmount)}</span>
                              <span className="text-gray-400 text-xs tabular-nums">Paid: {formatCurrency(sale.amountPaid)}</span>
                           </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.salesHistory.length === 0 && (
                    <tr><td colSpan={4} className="p-4 text-center text-gray-400">No orders found in this timeframe.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <h3 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2 border-t border-[#333] pt-6 text-white">
              <Clock className="text-green-500" /> Payment History ({timeframe})
            </h3>
            <div className="overflow-x-auto rounded-lg border border-[#333]">
              <table className="w-full text-left">
                <thead className="bg-[#222]">
                  <tr className="border-b border-[#333] text-gray-400 text-xs uppercase tracking-wider">
                    <th className="p-3">Date & Time</th>
                    <th className="p-3">Description</th>
                    <th className="p-3 text-right">Amount Received</th>
                  </tr>
                </thead>
                <tbody>
                  {data.paymentHistory.map((pay: any) => (
                    <tr key={pay.id} className="border-b border-[#333] last:border-0 hover:bg-[#2a2a2a] text-sm">
                      <td className="p-3 text-gray-300 whitespace-nowrap">{formatDateIST(pay.date)}</td>
                      <td className="p-3 text-gray-400">{pay.description}</td>
                      <td className="p-3 font-bold text-green-400 text-right tabular-nums">{formatCurrency(pay.amount)}</td>
                    </tr>
                  ))}
                  {data.paymentHistory.length === 0 && (
                    <tr><td colSpan={3} className="p-4 text-center text-gray-400">No payments received in this timeframe.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function CustomerDetail() {
  return (
    <Suspense fallback={<div className="text-gray-400">Loading customer profile...</div>}>
       <CustomerDetailContent />
    </Suspense>
  );
}