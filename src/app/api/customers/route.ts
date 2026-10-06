import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';



export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const customers = await prisma.customer.findMany({
      include: {
        sales: { where: { isDeleted: false }, select: { date: true, totalValue: true, amountPaid: true } },
        payments: { where: { status: 'APPROVED' }, select: { amount: true } }
      }
    });

    const now = new Date();
    const enriched = customers.map(c => {
      const totalInvoiced = c.sales.reduce((sum, s) => sum + Number(s.totalValue), 0);
      const totalPaid = c.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const currentBalance = totalInvoiced - totalPaid;

      const unpaidSales = c.sales.filter(s => Number(s.amountPaid) < Number(s.totalValue));
      let oldestUnpaidDays = 0;
      if (unpaidSales.length > 0) {
        const oldestDate = new Date(Math.min(...unpaidSales.map(s => new Date(s.date).getTime())));
        oldestUnpaidDays = Math.floor((now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      return {
        id: c.id,
        name: c.name,
        contact: c.contact,
        address: c.address,
        gst: c.gst,
        transport: c.transport,
        creditLimit: Number(c.creditLimit || 7000000),
        creditDays: c.creditDays || 18,
        currentBalance,
        oldestUnpaidDays,
        isOverdue: oldestUnpaidDays > (c.creditDays || 18),
        isLimitExceeded: currentBalance > Number(c.creditLimit || 7000000)
      };
    });

    return NextResponse.json({ customers: enriched });
  } catch (error) {
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
