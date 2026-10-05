'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, User, ShieldAlert, Cpu, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        redirect: false,
        username: username.trim()
      });

      if (result?.error) {
        if (result.error.includes('SECURITY_LOCKOUT')) {
          setError('🚨 SECURITY LOCKOUT: 5 consecutive failed attempts detected. Terminal temporarily locked for 15 minutes.');
          toast.error('Terminal locked due to excessive failed attempts.');
        } else if (result.error.includes('INVALID_CREDENTIALS')) {
          setError(result.error.replace('Error: ', ''));
          toast.error('Authentication failed: Invalid credentials.');
        } else {
          setError('Invalid username or password. Please verify credentials.');
          toast.error('Invalid credentials.');
        }
        setLoading(false);
      } else {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('erp_auth_session', 'active');
        }
        toast.success('Identity verified. Loading secure dashboard...');
        router.push('/');
        router.refresh();
      }
    } catch {
      setError('Connection to security gateway failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#0a0b0e]">
      {/* Dynamic Ambient Glow Gradients */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-orange-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-red-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(#1c1e29_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      {/* Main Terminal Card */}
      <div className="relative w-full max-w-md z-10">
        {/* Glow Border Frame */}
        <div className="bg-[#11131a]/90 backdrop-blur-2xl border border-orange-500/30 rounded-2xl p-6 sm:p-8 shadow-[0_0_50px_rgba(234,88,12,0.12)] space-y-6">
          
          {/* Header & Official Company Emblem */}
          <div className="flex flex-col items-center text-center space-y-3 pt-1">
            <div className="relative">
              <div className="absolute -inset-1.5 bg-gradient-to-r from-red-600 via-orange-500 to-red-600 rounded-full blur-md opacity-75 animate-pulse" />
              <div className="relative w-32 h-32 sm:w-36 sm:h-36 bg-white rounded-full p-2.5 flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.35)] border-2 border-red-600/50 overflow-hidden">
                <img 
                  src="/logo.png" 
                  alt="Company Logo" 
                  className="w-full h-full object-contain" 
                />
              </div>
            </div>

            <div className="pt-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-orange-500/10 text-orange-400 border border-orange-500/30 mb-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Zero-Trust Secure Gateway
              </span>
              <p className="text-xs text-gray-300 font-bold tracking-wide mt-1">
                Industrial Manufacturing ERP
              </p>
            </div>
          </div>

          {/* Security Alert Banner */}
          {error && (
            <div className="bg-red-950/60 border border-red-500/50 text-red-300 p-3.5 rounded-xl text-xs flex items-start gap-2.5 shadow-lg animate-in fade-in zoom-in-95 duration-200">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-medium">{error}</div>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username Input */}
            <div>
              <label htmlFor="username" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Operator Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400 z-10">
                  <User size={18} />
                </div>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  style={{ paddingLeft: '2.85rem' }}
                  className="w-full pr-4 py-3 bg-[#161822] border border-[#2d3142] focus:border-orange-500 text-white rounded-xl text-sm font-medium transition-colors outline-none"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>



            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-gradient-to-r from-orange-600 via-orange-500 to-red-600 hover:from-orange-500 hover:to-red-500 text-white font-bold rounded-xl text-sm shadow-[0_0_25px_rgba(234,88,12,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Authenticating Gateway...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={18} />
                  <span>Verify Identity & Enter Portal</span>
                </>
              )}
            </button>
          </form>

          {/* Security Architecture Footnote */}
          <div className="pt-4 border-t border-[#232634] grid grid-cols-3 gap-2 text-center text-[10px] text-gray-400 font-medium">
            <div className="flex flex-col items-center gap-1 p-1.5 rounded-lg bg-[#151720]">
              <Cpu size={14} className="text-orange-400" />
              <span>Zero-Cache</span>
            </div>
            <div className="flex flex-col items-center gap-1 p-1.5 rounded-lg bg-[#151720]">
              <ShieldCheck size={14} className="text-emerald-400" />
              <span>Anti-Brute</span>
            </div>
            <div className="flex flex-col items-center gap-1 p-1.5 rounded-lg bg-[#151720]">
              <Sparkles size={14} className="text-blue-400" />
              <span>Role-Shielded</span>
            </div>
          </div>

          <p className="text-[10px] text-center text-gray-400 select-none">
            Authorized Personnel Only • IP & Device Hardware Fingerprinted
          </p>

          <div className="flex items-center justify-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Cloud Production Active • v1.0.0
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
