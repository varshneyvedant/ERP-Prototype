import { getServerSession, authOptions } from '@/lib/mock-session';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';


import { getFIFOInventoryValue } from '@/lib/analytics/inventory';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const inventory = await getFIFOInventoryValue();
    const currentCostPerTon = inventory.remainingStockTons > 0 ? (inventory.fifoCost / inventory.remainingStockTons) : 0;
    return NextResponse.json({ costPerTon: currentCostPerTon, remainingStockTons: inventory.remainingStockTons });
  } catch (error) {
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
