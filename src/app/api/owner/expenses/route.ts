import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




import { prisma } from '@/lib/prisma';


import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';


import { format, eachMonthOfInterval, startOfMonth, isSameMonth } from 'date-fns';



export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as any).role?.toLowerCase() !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const timeframe = (searchParams.get('timeframe') as Timeframe) || '1M';
    const startDate = getStartDateFromTimeframe(timeframe);
    const endDate = new Date();

    const expenses = await prisma.expense.findMany({
      where: { isDeleted: false, date: { gte: startDate, lte: endDate } },
      orderBy: { date: 'asc' }
    });

    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    const categoryBreakdown = await prisma.expense.groupBy({
      by: ['category'],
      where: { date: { gte: startDate, lte: endDate } },
      _sum: { amount: true }
    });

    const breakdown = categoryBreakdown.map(c => ({
      category: c.category,
      amount: c._sum.amount || 0,
      percent: totalExpenses > 0 ? (Number(c._sum.amount || 0) / totalExpenses) * 100 : 0
    })).sort((a, b) => Number(b.amount) - Number(a.amount));

    // Build trendline
    let intervals = eachMonthOfInterval({ start: startDate, end: endDate });
    // If 'ALL' is too big, bound it
    if (intervals.length > 60) {
      intervals = intervals.slice(-60);
    }

    const trends = intervals.map(intervalDate => {
      const monthExpenses = expenses.filter(e => isSameMonth(e.date, intervalDate));
      const point: any = { period: format(intervalDate, 'MMM yyyy'), Total: 0 };

      monthExpenses.forEach(e => {
        point.Total += Number(e.amount);
        point[e.category] = (point[e.category] || 0) + Number(e.amount);
      });

      return point;
    });

    return NextResponse.json({
      success: true,
      data: {
        totalExpenses,
        breakdown,
        trends,
        rawList: expenses.slice(-100).reverse() // send last 100 for the table
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
