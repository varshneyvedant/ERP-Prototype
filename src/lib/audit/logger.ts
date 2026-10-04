import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

interface AuditLogOptions {
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'DAY_CLOSE';
  module: string;
  description: string;
  details?: any; // e.g. JSON of old/new data
}

export async function logAudit({ action, module, description, details }: AuditLogOptions) {
  try {
    const session = await getServerSession(authOptions);
    const userRole = session?.user?.role || 'SYSTEM'; // Fallback for automated jobs if any

    await prisma.auditLog.create({
      data: {
        user: userRole,
        action,
        module,
        description,
        details: details ? JSON.stringify(details) : null
      }
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
    // We intentionally don't throw here to prevent breaking the main transaction
  }
}
