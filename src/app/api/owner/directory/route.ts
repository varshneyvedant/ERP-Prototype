import { getServerSession, authOptions } from '@/lib/mock-session';
import { OwnerDirectoryPostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




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
    const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
    const customersWithInvoices = await prisma.customer.findMany({
      orderBy: { name: 'asc' },
      include: {
        sales: {
          where: { isDeleted: false },
          include: {
            creditNotes: true
          }
        }
      }
    });

    const customers = customersWithInvoices.map(cust => {
      let bucket0_30 = 0;
      let bucket31_60 = 0;
      let bucket61_90 = 0;
      let bucket90_plus = 0;
      let totalOutstanding = 0;

      cust.sales.forEach(sale => {
        const totalVal = Number(sale.totalValue);
        const amountPaid = Number(sale.amountPaid);
        const creditNotesSum = sale.creditNotes.reduce((sum, cn) => sum + Number(cn.amountCredited), 0);
        const outstanding = totalVal - amountPaid - creditNotesSum;

        if (outstanding > 0.01) {
          totalOutstanding += outstanding;
          const ageInDays = Math.floor((Date.now() - new Date(sale.date).getTime()) / (1000 * 60 * 60 * 24));
          if (ageInDays <= 30) {
            bucket0_30 += outstanding;
          } else if (ageInDays <= 60) {
            bucket31_60 += outstanding;
          } else if (ageInDays <= 90) {
            bucket61_90 += outstanding;
          } else {
            bucket90_plus += outstanding;
          }
        }
      });

      // Maintain direct creditBalance field but populate it with ground truth total outstanding as well
      return {
        id: cust.id,
        name: cust.name,
        contact: cust.contact,
        address: cust.address,
        gst: cust.gst,
        transport: cust.transport,
        creditBalance: totalOutstanding,
        createdAt: cust.createdAt,
        updatedAt: cust.updatedAt,
        aging: {
          bucket0_30,
          bucket31_60,
          bucket61_90,
          bucket90_plus,
          total: totalOutstanding
        }
      };
    });

    return NextResponse.json({ success: true, data: { customers, suppliers } });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Database transaction failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as any).role?.toLowerCase() !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validation = OwnerDirectoryPostSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { action, type, id, data } = validation.data;

    if (action === 'CREATE') {
      if (type === 'CUSTOMER') {
        const c = await prisma.customer.create({ data });
        return NextResponse.json({ success: true, item: c });
      } else {
        const s = await prisma.supplier.create({ data });
        return NextResponse.json({ success: true, item: s });
      }
    } else if (action === 'UPDATE') {
      if (type === 'CUSTOMER') {
        const c = await prisma.customer.update({ where: { id }, data });
        return NextResponse.json({ success: true, item: c });
      } else {
        const s = await prisma.supplier.update({ where: { id }, data });
        return NextResponse.json({ success: true, item: s });
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
