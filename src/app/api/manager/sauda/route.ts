import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit/logger';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const status = searchParams.get('status');

    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    const contracts = await prisma.saudaContract.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, contact: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ success: true, contracts });
  } catch (error: any) {
    console.error('Failed to fetch Sauda contracts:', error);
    return NextResponse.json({ error: 'Failed to fetch contracts' }, { status: 500 });
  }
}

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
    const { customerId, ratePerKg, totalQtyTons, expiryDate, notes } = body;

    if (!customerId || !ratePerKg || !totalQtyTons) {
      return NextResponse.json({ error: 'Customer, Booked Rate, and Quantity are required' }, { status: 400 });
    }

    const rateNum = Number(ratePerKg);
    const qtyNum = Number(totalQtyTons);

    if (rateNum <= 0 || qtyNum <= 0) {
      return NextResponse.json({ error: 'Rate and Quantity must be positive numbers' }, { status: 400 });
    }

    const contractValue = qtyNum * (rateNum * 1000); // 1 Ton = 1000 Kg
    
    // Check Credit Limit (Protect against infinite booking exploit)
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        sales: { where: { isDeleted: false } },
        payments: { where: { status: 'APPROVED' } }
      }
    });
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    const totalInvoiced = customer.sales.reduce((sum, s) => sum + Number(s.totalValue), 0);
    const totalPaid = customer.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const currentBalance = totalInvoiced - totalPaid;
    const creditLimit = Number(customer.creditLimit || 7000000);

    // Only Owner can bypass credit limit checks for Sauda
    if (role !== 'owner' && (currentBalance + contractValue) > creditLimit) {
      return NextResponse.json({ 
        error: `Booking this Sauda (Value: ₹${contractValue.toLocaleString('en-IN')}) would exceed the customer's remaining credit limit of ₹${(creditLimit - currentBalance).toLocaleString('en-IN')}. Owner authorization required.`
      }, { status: 400 });
    }

    const contractNo = `SAU-${Date.now().toString().slice(-6)}`;

    const contract = await prisma.saudaContract.create({
      data: {
        contractNo,
        customerId,
        ratePerKg: rateNum,
        totalQtyTons: qtyNum,
        remainingQty: qtyNum,
        status: 'ACTIVE',
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        notes: notes || null,
      },
      include: {
        customer: true
      }
    });

    await logAudit({
      action: 'CREATE',
      module: 'Sauda',
      description: `Created Sauda Contract ${contractNo} for ${contract.customer.name}: ${qtyNum}T @ ₹${rateNum}/Kg`,
      details: { id: contract.id, contractNo, customerId, rateNum, qtyNum }
    });

    return NextResponse.json({ success: true, contract });
  } catch (error: any) {
    console.error('Failed to create Sauda contract:', error);
    return NextResponse.json({ error: error.message || 'Failed to create contract' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Contract ID is required' }, { status: 400 });
    }

    const contract = await prisma.saudaContract.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    await logAudit({
      action: 'UPDATE',
      module: 'Sauda',
      description: `Cancelled Sauda Contract ${contract.contractNo}`,
      details: { id }
    });

    return NextResponse.json({ success: true, contract });
  } catch (error: any) {
    console.error('Failed to cancel contract:', error);
    return NextResponse.json({ error: error.message || 'Failed to cancel contract' }, { status: 500 });
  }
}
