'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard, LogOut, Package, PackageOpen,
  Banknote, ShoppingCart, Users, Receipt,
  Trash2, TrendingUp, HandCoins, Building2, Briefcase,
  LineChart, Box, BookOpen, Activity, UserCog, ShieldCheck,
  RotateCcw, Lock, FileText, Menu, X
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

export default function Sidebar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [activeRole, setActiveRole] = useState<string>('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (session) {
      const realRole = ((session?.user as any)?.role || 'manager').toLowerCase();
      const saved = localStorage.getItem('simulated_role');
      if (realRole === 'owner' && saved) {
        setActiveRole(saved);
      } else {
        setActiveRole(realRole);
      }
    }
  }, [session]);

  if (pathname === '/login' || !session) return null;

  const realRole = ((session?.user as any)?.role || 'manager').toLowerCase();
  const displayRole = activeRole || realRole;

  const handleRoleToggle = (newRole: string) => {
    setActiveRole(newRole);
    localStorage.setItem('simulated_role', newRole);
  };

  const dashboardLink = displayRole === 'owner' ? '/owner/dashboard' : displayRole === 'accountant' ? '/owner/financials' : '/manager/dashboard';

  return (
    <>
      {/* Mobile Sticky Header Bar */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-[#141414]/95 backdrop-blur-md border-b border-[#333] z-40 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <button 
            onClick={() => setMobileOpen(true)}
            aria-label="Open Navigation Menu"
            className="p-2 rounded-lg bg-[#1e1e1e] border border-[#333] text-white hover:text-red-500 transition-colors focus:outline-none focus:ring-1 focus:ring-red-500"
          >
            <Menu size={20} />
          </button>
          <img src="/logo.png" alt="VEI Logo" className="w-8 h-8 object-contain rounded-lg bg-white/95 p-0.5 shadow-sm" />
          <div className="flex flex-col">
            <span className="text-xs font-black tracking-wider text-red-500">VARSHNEY</span>
            <span className="text-[9px] font-bold text-gray-400">ELECTRICAL INDUSTRIES</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded border ${displayRole === 'owner' ? 'bg-red-950/40 text-red-400 border-red-500/20' : 'bg-orange-950/40 text-orange-400 border-orange-500/20'}`}>
            {displayRole}
          </span>
        </div>
      </header>

      {/* Backdrop */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 md:hidden transition-opacity" 
          onClick={() => setMobileOpen(false)} 
        />
      )}

      {/* Sidebar Drawer */}
      <aside className={`w-72 sm:w-64 bg-[#141414] border-r border-[#333] h-screen fixed left-0 top-0 flex flex-col shadow-2xl z-50 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-out`}>
      <div className="p-4 border-b border-[#333] bg-[#1a1a1a] flex justify-between items-start">
        <div className="w-full">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-11 h-11 bg-white/95 rounded-xl p-1 flex items-center justify-center shadow-md border border-red-500/30 shrink-0">
              <img src="/logo.png" alt="Varshney Electrical Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-black text-red-500 tracking-wider">VARSHNEY</span>
              <span className="text-[9px] text-gray-400 font-black tracking-widest mt-0.5">ELECTRICAL IND.</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 mt-1">
            <p className="text-xs text-gray-400 font-medium tracking-wide flex items-center gap-1">
              <ShieldCheck size={12} className="text-red-500" />
              REAL ROLE: {realRole.toUpperCase()}
            </p>
            {realRole === 'owner' && (
              <div className="flex items-center justify-between bg-[#222] p-1.5 rounded border border-[#333] mt-1">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider pl-1 flex items-center gap-1">
                  <UserCog size={10} /> Active View
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleRoleToggle('owner')}
                    className={`text-[9px] px-2 py-0.5 rounded font-black transition-all ${displayRole === 'owner' ? 'bg-red-500 text-white shadow' : 'text-gray-400 hover:text-gray-300'}`}
                  >
                    OWNER
                  </button>
                  <button
                    onClick={() => handleRoleToggle('manager')}
                    className={`text-[9px] px-2 py-0.5 rounded font-black transition-all ${displayRole === 'manager' ? 'bg-orange-500 text-white shadow' : 'text-gray-400 hover:text-gray-300'}`}
                  >
                    MGR
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#2a2a2a] transition-colors"
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="mb-4">
          <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Overview</h3>
          <div className="flex flex-col gap-1">
            <Link href={dashboardLink} className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === dashboardLink || pathname === '/' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
              <LayoutDashboard size={18} />
              Dashboard
            </Link>
          </div>
        </div>

        {displayRole === 'manager' && (
           <>
              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Inventory & Production</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/shared/inventory/finished" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/shared/inventory/finished' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <PackageOpen size={18} />
                    Finished Goods Stock
                  </Link>
                  <Link href="/manager/market-price" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/market-price' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <TrendingUp size={18} />
                    Market Price
                  </Link>
                  <Link href="/manager/production" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/production' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Package size={18} />
                    Production Entry
                  </Link>
                  <Link href="/manager/scrap" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/scrap' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Trash2 size={18} />
                    Scrap Management
                  </Link>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Sales & Purchases</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/manager/sauda" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/sauda' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Lock size={18} />
                    Rate Booking (Sauda)
                  </Link>
                  <Link href="/manager/sales" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/sales' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <ShoppingCart size={18} />
                    Sales Invoice
                  </Link>
                  <Link href="/manager/gate-receipt" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/gate-receipt' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <PackageOpen size={18} />
                    Gate Inward Log
                  </Link>
                  <Link href="/manager/purchase" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/purchase' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Package size={18} />
                    Purchase Entry
                  </Link>
                  <Link href="/manager/returns" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/returns' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <RotateCcw size={18} />
                    Quality Returns
                  </Link>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Finance & Accounting</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/manager/payments" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/payments' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Banknote size={18} />
                    Payments
                  </Link>
                  <Link href="/manager/expenses" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/expenses' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Receipt size={18} />
                    Factory Expenses
                  </Link>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">HR & Payroll</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/manager/attendance" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/attendance' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Users size={18} />
                    Attendance
                  </Link>
                  <Link href="/manager/advances" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/advances' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <HandCoins size={18} />
                    Give Advance
                  </Link>
                  <Link href="/manager/day-close" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/manager/day-close' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Lock size={18} />
                    Day Close
                  </Link>
                </div>
              </div>
           </>
        )}

        {displayRole === 'accountant' && (
           <div className="mb-4">
             <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Accounts (Read-only)</h3>
             <div className="flex flex-col gap-1">
               <Link href="/owner/financials" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/financials' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                 <LineChart size={18} />
                 Financial Dashboard
               </Link>
               <Link href="/owner/journals" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/journals' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                 <FileText size={18} />
                 General Ledger GL
               </Link>
               <Link href="/reports" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/reports' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                 <FileText size={18} />
                 Reports: Aging, Profit
               </Link>
             </div>
           </div>
        )}

        {displayRole === 'owner' && (
           <>
              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Finance & Accounting</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/owner/financials" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/financials' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <LineChart size={18} />
                    Financial Dashboard
                  </Link>
                  <Link href="/owner/expenses" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/expenses' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Receipt size={18} />
                    Expenses Deep Dive
                  </Link>
                  <Link href="/owner/journals" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/journals' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <FileText size={18} />
                    General Ledger GL
                  </Link>
                  <Link href="/owner/period-lock" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/period-lock' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Lock size={18} />
                    Period Locking
                  </Link>
                  <Link href="/reports" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/reports' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <FileText size={18} />
                    Reports: Aging, Profit, Backup
                  </Link>
                  <Link href="/owner/salary" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/salary' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Receipt size={18} />
                    Salary Payout
                  </Link>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Inventory & Production</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/shared/inventory/finished" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/shared/inventory/finished' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <PackageOpen size={18} />
                    Finished Goods Stock
                  </Link>
                  <Link href="/owner/inventory" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/inventory' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Package size={18} />
                    Raw Copper Analytics
                  </Link>
                  <Link href="/owner/products" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/products' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Box size={18} />
                    Products & Brands
                  </Link>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Stakeholders</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/owner/stakeholders" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/stakeholders' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Building2 size={18} />
                    Customers & Suppliers
                  </Link>
                  <Link href="/owner/directory" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/directory' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <BookOpen size={18} />
                    Manage Directory
                  </Link>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">HR & Payroll</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/owner/employees" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/employees' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Briefcase size={18} />
                    Employee Management
                  </Link>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">System</h3>
                <div className="flex flex-col gap-1">
                  <Link href="/owner/audit" className={`flex items-center gap-3 p-3 text-sm rounded-md transition-colors font-medium ${pathname === '/owner/audit' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-400 hover:text-white hover:bg-[#2a2a2a]'}`}>
                    <Activity size={18} />
                    System Audit Trail
                  </Link>
                </div>
              </div>
           </>
        )}
      </div>

      <div className="p-4 border-t border-[#333]">
        <button
          onClick={() => {
            if (typeof window !== 'undefined') {
              sessionStorage.removeItem('vei_auth_session');
              localStorage.removeItem('simulated_role');
            }
            signOut({ callbackUrl: '/login' });
          }}
          className="flex items-center justify-center gap-2 w-full bg-red-950/20 hover:bg-red-900/50 text-red-500 p-2 rounded-md transition-colors font-medium text-sm border border-red-500/20 cursor-pointer"
        >
           <LogOut size={16} /> Secure Logout
        </button>
      </div>
      </aside>
    </>
  );
}
