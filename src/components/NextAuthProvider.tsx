'use client';
import { SessionProvider } from 'next-auth/react';
import { type ReactNode } from 'react';

export default function NextAuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider session={{ user: { name: 'owner', email: 'owner', image: '', role: 'owner', id: '1', username: 'owner' }, expires: '9999-12-31T23:59:59.999Z' }}>
      {children}
    </SessionProvider>
  );
}