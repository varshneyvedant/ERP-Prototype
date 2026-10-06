import { getServerSession, authOptions } from '@/lib/mock-session';
import { OwnerEmployeePostSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




import { prisma } from '@/lib/prisma';


import { subMonths, startOfMonth } from 'date-fns';



export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as any).role?.toLowerCase() !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const employees = await prisma.employee.findMany({
      include: {
        advances: true,
        attendances: {
          where: {
            date: { gte: startOfMonth(new Date()) } // current month attendance
          }
        }
      }
    });

    const enrichedEmployees = employees.map(emp => {
      const totalAdvances = emp.advances.reduce((sum, a) => sum + (Number(a.amount) - Number(a.amountRepaid)), 0);

      // Calculate how many months of advance they have taken
      const monthsAdvance = Number(emp.baseSalary) > 0 ? (totalAdvances / Number(emp.baseSalary)) : 0;

      // Dynamic warning logic (> 4 months)
      const advanceWarning = monthsAdvance > 4;

      // Calculate current month presence
      const presentDays = emp.attendances.filter(a => a.status === 'Present').length;
      const halfDays = emp.attendances.filter(a => a.status === 'Half_day').length;
      const totalEffectiveDays = presentDays + (halfDays * 0.5);

      return {
        id: emp.id,
        name: emp.name,
        role: emp.role,
        baseSalary: emp.baseSalary,
        totalAdvances,
        monthsAdvance: monthsAdvance.toFixed(1),
        advanceWarning,
        currentMonthDays: totalEffectiveDays
      };
    });

    return NextResponse.json({ success: true, employees: enrichedEmployees });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
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
    const validation = OwnerEmployeePostSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { name, role, baseSalary } = validation.data;

    const employee = await prisma.employee.create({
      data: {
        name,
        role,
        baseSalary: baseSalary,
        salaryHistory: {
          create: {
            date: new Date(),
            amount: baseSalary,
            reason: 'Joining Salary'
          }
        }
      }
    });

    return NextResponse.json({ success: true, employee });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
