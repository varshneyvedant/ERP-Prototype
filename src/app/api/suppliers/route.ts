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
    const suppliers = await prisma.supplier.findMany({
      include: {
        purchases: { where: { isDeleted: false }, select: { totalValue: true } },
        payments: { where: { status: 'APPROVED' }, select: { amount: true } }
      }
    });

    const enriched = suppliers.map(s => {
      const totalPurchases = s.purchases.reduce((sum, p) => sum + Number(p.totalValue), 0);
      const totalPaid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const currentBalance = totalPurchases - totalPaid;

      return {
        id: s.id,
        name: s.name,
        contact: s.contact,
        address: s.address,
        gst: s.gst,
        currentBalance
      };
    });

    return NextResponse.json({ suppliers: enriched });
  } catch (error) {
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
