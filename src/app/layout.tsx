import Providers from '@/components/Providers';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/layout/AppShell';
import NextAuthProvider from '@/components/NextAuthProvider';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'], display: 'swap', fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] });

export const metadata: Metadata = {
  title: 'Manufacturing ERP Prototype',
  description: 'Internal tracking & double-entry ERP for manufacturing',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

import type { Viewport } from 'next';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#121212',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <NextAuthProvider>
          <Providers>
            <Toaster theme="dark" richColors position="top-right" />
            <AppShell>
              {children}
            </AppShell>
          </Providers>
        </NextAuthProvider>
      </body>
    </html>
  );
}
