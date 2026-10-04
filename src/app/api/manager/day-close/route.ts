export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  // Get system cash
  const cashLines = await prisma.journalLine.aggregate({
    where: { accountName: 'Cash & Bank' },
    _sum: { debit: true, credit: true }
  });
  const systemCash = Number(cashLines._sum.debit || 0) - Number(cashLines._sum.credit || 0);
  
  // Find last close
  const lastClose = await prisma.auditLog.findFirst({
    where: { action: 'DAY_CLOSE' },
    orderBy: { date: 'desc' }
  });

  return NextResponse.json({ success: true, systemCash, lastClose });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { physicalCash, notes } = body;

    if (physicalCash === undefined || physicalCash === null) {
      return NextResponse.json({ error: 'Physical cash amount is required' }, { status: 400 });
    }

    const declaredCash = Number(physicalCash);

    // Calculate system cash balance
    const cashLines = await prisma.journalLine.aggregate({
      where: { accountName: 'Cash & Bank' },
      _sum: { debit: true, credit: true }
    });
    
    const systemCash = Number(cashLines._sum.debit || 0) - Number(cashLines._sum.credit || 0);
    const discrepancy = declaredCash - systemCash;

    // Log the event
    await logAudit({
      action: 'DAY_CLOSE',
      module: 'Finance',
      description: `Day Close. Physical: ,1${declaredCash.toLocaleString('en-IN')}, System: ,1${systemCash.toLocaleString('en-IN')}. Diff: ,1${discrepancy.toLocaleString('en-IN')}`,
      details: { declaredCash, systemCash, discrepancy, notes }
    });

    return NextResponse.json({ 
      success: true, 
      data: {
        declaredCash,
        systemCash,
        discrepancy
      }
    });
  } catch (error: any) {
    console.error('Failed to process Day Close:', error);
    return NextResponse.json({ error: 'Failed to process Day Close' }, { status: 500 });
  }
}
