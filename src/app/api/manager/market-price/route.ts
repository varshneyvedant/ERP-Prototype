import { getServerSession, authOptions } from '@/lib/mock-session';
import { ManagerMarketPricePostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




import { prisma } from '@/lib/prisma';



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
    const validation = ManagerMarketPricePostSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { price } = validation.data;

    const marketPrice = await prisma.marketPrice.create({
      data: {
        date: new Date(),
        price: price * 1000 // Convert KG to Ton
      }
    });

    return NextResponse.json({ success: true, marketPrice });
  } catch (error) {
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
