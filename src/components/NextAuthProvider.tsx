'use client';

import { SessionProvider, useSession, signOut } from 'next-auth/react';
import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

function SessionLifecycleGuard({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    // Only check protected routes
    if (pathname === '/login') return;

    if (status === 'authenticated' && session) {
      const isTabSessionActive = typeof window !== 'undefined' ? sessionStorage.getItem('erp_auth_session') : null;
      if (!isTabSessionActive) {
        // Tab/Browser was freshly opened or restored — force re-authentication with password
        signOut({ redirect: true, callbackUrl: '/login' });
      }
    }
  }, [status, session, pathname]);

  return <>{children}</>;
}

export default function NextAuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SessionLifecycleGuard>
        {children}
      </SessionLifecycleGuard>
    </SessionProvider>
  );
}
