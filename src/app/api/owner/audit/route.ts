import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';



export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role?.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const timeframe = (searchParams.get('timeframe') as Timeframe) || '1M';
    const startDate = getStartDateFromTimeframe(timeframe);

    // Optional filters
    const moduleFilter = searchParams.get('module');
    const actionFilter = searchParams.get('action');

    const whereClause: any = {
      date: { gte: startDate }
    };

    if (moduleFilter && moduleFilter !== 'ALL') whereClause.module = moduleFilter;
    if (actionFilter && actionFilter !== 'ALL') whereClause.action = actionFilter;

    const logs = await prisma.auditLog.findMany({
      where: whereClause,
      orderBy: { date: 'desc' },
      take: 500 // Limit to prevent massive payloads
    });

    return NextResponse.json({ success: true, data: logs });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
