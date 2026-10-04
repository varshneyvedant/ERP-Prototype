import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';

// Brute-force protection is persisted in the database (LoginAttempt) so it works across
// serverless instances. (The previous in-memory Map reset on every cold start / instance.)
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 Minutes
const WINDOW_DURATION_MS = 15 * 60 * 1000;  // 15 Minutes

async function registerFailure(key: string, now: Date, previous: { count: number; lastAttempt: Date } | null): Promise<never> {
  const count = previous && now.getTime() - previous.lastAttempt.getTime() < WINDOW_DURATION_MS ? previous.count + 1 : 1;
  const locked = count >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = locked ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null;
  await prisma.loginAttempt.upsert({
    where: { key },
    create: { key, count, lastAttempt: now, lockedUntil },
    update: { count, lastAttempt: now, lockedUntil }
  });
  if (locked) {
    throw new Error('SECURITY_LOCKOUT: 5 failed attempts detected. Terminal locked for 15 minutes.');
  }
  throw new Error(`INVALID_CREDENTIALS: Invalid username or password (${MAX_FAILED_ATTEMPTS - count} attempt(s) remaining).`);
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error('Please enter both username and password.');
        }

        const key = credentials.username.toLowerCase().trim();
        const now = new Date();
        const attempt = await prisma.loginAttempt.findUnique({ where: { key } });

        // 1. Check if user is currently locked out
        if (attempt?.lockedUntil && attempt.lockedUntil.getTime() > now.getTime()) {
          const remainingMinutes = Math.ceil((attempt.lockedUntil.getTime() - now.getTime()) / 60000);
          throw new Error(`SECURITY_LOCKOUT: Account locked due to repeated failed attempts. Please retry in ${remainingMinutes} minute(s).`);
        }

        const user = await prisma.user.findUnique({
          where: { username: credentials.username }
        });

        if (!user) {
          // Constant-time: prevent user enumeration via timing
          await bcrypt.compare(credentials.password, '$2b$10$dummyhashtopreventtimingattacks000000000000000');
          return registerFailure(key, now, attempt);
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
        if (!isPasswordValid) {
          return registerFailure(key, now, attempt);
        }

        // On successful authentication, reset failed attempts
        if (attempt) await prisma.loginAttempt.delete({ where: { key } }).catch(() => {});

        return {
          id: user.id,
          name: user.username,
          role: user.role
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
        token.username = user.name || undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
        session.user.username = token.username as string;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 60, // 30 minutes max inactive session timeout
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        // Omitting maxAge forces browser to treat this as a Session-Only cookie (destroyed when browser closes)
      }
    }
  },
  secret: process.env.NEXTAUTH_SECRET!,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
