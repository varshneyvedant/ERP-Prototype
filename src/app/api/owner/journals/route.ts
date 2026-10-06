import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';



export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['owner', 'accountant'].includes((session.user as any)?.role?.toLowerCase())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const journals = await prisma.journalEntry.findMany({
      orderBy: { date: 'desc' },
      include: {
        lines: true
      }
    });

    return NextResponse.json({ success: true, journals });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}
