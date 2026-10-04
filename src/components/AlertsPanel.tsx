'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

type Alert = { severity: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; detail: string; href?: string };

const STYLE: Record<Alert['severity'], string> = {
  CRITICAL: 'border-red-500/60 bg-red-950/30 text-red-300',
  WARNING: 'border-orange-500/50 bg-orange-950/20 text-orange-300',
  INFO: 'border-blue-500/40 bg-blue-950/20 text-blue-300'
};
const DOT: Record<Alert['severity'], string> = { CRITICAL: '🔴', WARNING: '🟠', INFO: '🔵' };

export default function AlertsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['business-alerts'],
    queryFn: async () => {
      const res = await fetch('/api/reports/alerts');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      return json.data.alerts as Alert[];
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000
  });

  if (isLoading || !data || data.length === 0) return null;

  return (
    <div className="card space-y-2">
      <h3 className="text-sm font-black uppercase tracking-wider text-gray-300">Needs your attention ({data.length})</h3>
      <div className="space-y-2">
        {data.slice(0, 8).map((a, i) => {
          const body = (
            <div className={`p-3 rounded-lg border text-sm ${STYLE[a.severity]}`}>
              <div className="font-bold">{DOT[a.severity]} {a.title}</div>
              <div className="text-xs opacity-90 mt-0.5">{a.detail}</div>
            </div>
          );
          return a.href ? <Link key={i} href={a.href} className="block hover:opacity-90">{body}</Link> : <div key={i}>{body}</div>;
        })}
        {data.length > 8 && <div className="text-xs text-gray-500">+ {data.length - 8} more</div>}
      </div>
    </div>
  );
}
