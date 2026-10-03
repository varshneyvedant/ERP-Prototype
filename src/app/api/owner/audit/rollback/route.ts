export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { logAudit } from '@/lib/audit/logger';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role?.toLowerCase() !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { logId } = await request.json();
    if (!logId) return NextResponse.json({ error: 'Missing Log ID' }, { status: 400 });

    const auditLog = await prisma.auditLog.findUnique({ where: { id: logId } });
    if (!auditLog) return NextResponse.json({ error: 'Audit log not found' }, { status: 404 });

    if (auditLog.action !== 'CREATE') {
      return NextResponse.json({ error: 'Only CREATE actions can be rolled back automatically' }, { status: 400 });
    }

    const details = auditLog.details ? JSON.parse(auditLog.details) : {};
    const targetId = details.id;

    if (!targetId) {
      return NextResponse.json({ error: 'Target ID not found in log details. Cannot rollback historical logs without IDs.' }, { status: 400 });
    }

    const module = auditLog.module;

    await prisma.$transaction(async (tx) => {
      if (module === 'Sales') {
        const sale = await tx.sale.findUnique({ where: { id: targetId } });
        if (sale) {
          await tx.customerLedger.updateMany({
            where: { description: { startsWith: `Invoice Sale ID: ${targetId}` } },
            data: { isDeleted: true }
          });
          await tx.sale.update({ where: { id: targetId }, data: { isDeleted: true } });
          await tx.journalEntry.deleteMany({ where: { referenceType: 'SALE', referenceId: targetId } });
        }
      } else if (module === 'Purchases') {
        const purchase = await tx.purchase.findUnique({ where: { id: targetId } });
        if (purchase) {
          await tx.supplierLedger.updateMany({
            where: {
               supplierId: purchase.supplierId,
               amount: purchase.totalValue,
               date: purchase.date
            },
            data: { isDeleted: true }
          });
          await tx.purchase.update({ where: { id: targetId }, data: { isDeleted: true } });
          await tx.journalEntry.deleteMany({ where: { referenceType: 'PURCHASE', referenceId: targetId } });
        }
      } else if (module === 'Production') {
        const production = await tx.production.findUnique({ where: { id: targetId } });
        if (production) {
          await tx.scrapInventory.updateMany({
             where: {
                qty: production.scrapGenerated,
                date: production.date,
                type: 'GENERATED'
             },
             data: { isDeleted: true }
          });
          await tx.production.update({ where: { id: targetId }, data: { isDeleted: true } });
          await tx.journalEntry.deleteMany({ where: { referenceType: 'PRODUCTION', referenceId: targetId } });
        }
      } else if (module === 'Expense') {
        const expense = await tx.expense.findUnique({ where: { id: targetId } });
        if (expense) {
          await tx.expense.update({ where: { id: targetId }, data: { isDeleted: true } });
          await tx.journalEntry.deleteMany({ where: { referenceType: 'EXPENSE', referenceId: targetId } });
        }
      } else {
        throw new Error(`Rollback for module ${module} is not supported`);
      }
    });

    await logAudit({
      action: 'DELETE',
      module: 'System',
      description: `Rolled back ${module} creation (Log ID: ${logId})`,
      details: { rolledBackLogId: logId, targetId }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Rollback failed' }, { status: 500 });
  }
}
