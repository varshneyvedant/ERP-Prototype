import { getServerSession, authOptions } from '@/lib/mock-session';
import { NextResponse } from 'next/server';


import { timingSafeEqual } from 'crypto';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const role = (session.user as any).role?.toLowerCase();
    if (role !== 'manager' && role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { pin } = await request.json();
    const overridePin = process.env.OVERRIDE_PIN;

    if (!overridePin) {
      return NextResponse.json({ error: 'Override PIN is not configured on the server. Ask the Owner to set OVERRIDE_PIN.' }, { status: 503 });
    }

    const a = Buffer.from(String(pin ?? ''));
    const b = Buffer.from(overridePin);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid PIN' }, { status: 403 });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
