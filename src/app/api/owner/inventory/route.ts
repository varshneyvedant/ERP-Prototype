import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




import { getFIFOInventoryValue, getLowStockAlert } from '@/lib/analytics/inventory';


import { prisma } from '@/lib/prisma';



export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as any).role?.toLowerCase() !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const inventory = await getFIFOInventoryValue();
    const alertData = await getLowStockAlert(inventory.remainingStockTons);

    // Get Order History (Last 50 purchases)
    const orderHistory = await prisma.purchase.findMany({ where: { isDeleted: false },
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        supplier: true
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        ...inventory,
        alert: alertData,
        orderHistory: orderHistory.map(h => ({
          id: h.id,
          date: h.date,
          supplierName: h.supplier.name,
          qty: h.qty,
          pricePerTon: h.pricePerTon,
          totalValue: h.totalValue
        }))
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
