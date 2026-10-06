const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('./src');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Replace middleware to allow everything and redirect / to /owner/dashboard
  if (file.replace(/\\/g, '/').endsWith('src/middleware.ts')) {
    content = `import { NextResponse } from 'next/server';
export function middleware(request) {
  if (request.nextUrl.pathname === '/') {
    return NextResponse.redirect(new URL('/owner/dashboard', request.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/'] };`;
    changed = true;
  }

  // Replace NextAuthProvider to always provide an owner session
  if (file.replace(/\\/g, '/').endsWith('src/components/NextAuthProvider.tsx')) {
    content = `'use client';
import { SessionProvider } from 'next-auth/react';
import { type ReactNode } from 'react';

export default function NextAuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider session={{ user: { name: 'owner', email: 'owner', image: '', role: 'owner', id: '1', username: 'owner' }, expires: '9999-12-31T23:59:59.999Z' }}>
      {children}
    </SessionProvider>
  );
}`;
    changed = true;
  }

  // Replace getServerSession in APIs
  if (content.includes('getServerSession')) {
    content = content.replace(/import \{ getServerSession \} from 'next-auth';/g, '');
    content = content.replace(/import \{ authOptions \}.*;/g, '');
    
    const mockCode = `\nconst getServerSession = async (...args: any[]) => ({ user: { role: 'owner', id: '1', name: 'owner', username: 'owner' } });\n`;
    
    if (!content.includes("const getServerSession = async")) {
      // insert after imports
      content = content.replace(/(import .*;\n)+/, match => match + mockCode);
    }
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Modified', file);
  }
});
