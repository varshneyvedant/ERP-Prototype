import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';



export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role?.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const locks = await prisma.periodLock.findMany({
      orderBy: { yearMonth: 'desc' }
    });
    return NextResponse.json({ success: true, locks });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role?.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { yearMonth, locked } = body;

    // Validate format: YYYY-MM
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth) || typeof locked !== 'boolean') {
      return NextResponse.json({ error: 'Invalid parameters. yearMonth must be in YYYY-MM format.' }, { status: 400 });
    }

    const result = await prisma.periodLock.upsert({
      where: { yearMonth },
      update: { locked },
      create: { yearMonth, locked }
    });

    await logAudit({
      action: 'UPDATE',
      module: 'PeriodLock',
      description: `Owner ${locked ? 'LOCKED' : 'UNLOCKED'} the accounting month ${yearMonth}`,
      details: { yearMonth, locked }
    });

    return NextResponse.json({ success: true, lock: result });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
