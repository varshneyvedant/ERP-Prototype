export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const receipts = await prisma.gateReceipt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return NextResponse.json({ success: true, receipts });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const { materialType, supplierName, vehicleNo, challanWeight, actualWeight, notes } = body;

    if (!materialType || !challanWeight || !actualWeight) {
      return NextResponse.json({ error: 'Material, Challan Weight, and Actual Weight are required' }, { status: 400 });
    }

    const challanNum = Number(challanWeight);
    const actualNum = Number(actualWeight);
    const shortage = challanNum - actualNum;

    const receipt = await prisma.gateReceipt.create({
      data: {
        materialType,
        supplierName: supplierName || 'Unknown',
        vehicleNo: vehicleNo || '',
        challanWeight: challanNum,
        actualWeight: actualNum,
        shortage,
        notes: notes || '',
        isVerified: false
      }
    });

    await logAudit({
      action: 'CREATE',
      module: 'GateReceipt',
      description: `Logged incoming \${materialType} from \${supplierName}. Actual: \${actualNum}kg. Shortage: \${shortage}kg.`,
      details: { id: receipt.id, challanNum, actualNum, shortage }
    });

    return NextResponse.json({ success: true, receipt });
  } catch (error: any) {
    console.error('Failed to create gate receipt:', error);
    return NextResponse.json({ error: 'Failed to create gate receipt' }, { status: 500 });
  }
}
