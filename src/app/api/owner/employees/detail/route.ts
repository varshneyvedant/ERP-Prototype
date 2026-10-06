import { getServerSession, authOptions } from '@/lib/mock-session';
import { OwnerEmployeeDetailPutSchema } from '@/lib/validations';
export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';




import { prisma } from '@/lib/prisma';


import { getStartDateFromTimeframe, Timeframe } from '@/lib/timeframe';



export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if ((session.user as any).role?.toLowerCase() !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const timeframe = (searchParams.get('timeframe') as Timeframe) || '1M';

    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const startDate = getStartDateFromTimeframe(timeframe);

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        salaryHistory: {
          orderBy: { date: 'asc' }
        },
        advances: {
          include: {
            repayments: true
          }
        }, // Fetch all to get accurate static balance
        attendances: {
          where: { date: { gte: startDate } },
          orderBy: { date: 'desc' }
        }
      }
    });

    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    // Dynamic Timeframe attendance
    const presentDays = employee.attendances.filter(a => a.status === 'Present').length;
    const absentDays = employee.attendances.filter(a => a.status === 'Absent').length;
    const halfDays = employee.attendances.filter(a => a.status === "Half_day").length;

    const effectiveHours = (presentDays * 8.5) + (halfDays * 4.25);

    // Dynamic Productivity Calculation
    // We want to see how much we ACTUALLY paid per hour worked in this specific timeframe.
    // 1. Calculate how many months this timeframe represents (roughly)
    let monthsInTimeframe = 1;
    if (timeframe === '1W') monthsInTimeframe = 0.25;
    if (timeframe === '3M') monthsInTimeframe = 3;
    if (timeframe === '6M') monthsInTimeframe = 6;
    if (timeframe === '1Y' || timeframe === 'FY') monthsInTimeframe = 12;
    if (timeframe === '3Y') monthsInTimeframe = 36;
    if (timeframe === '5Y') monthsInTimeframe = 60;
    if (timeframe === '10Y') monthsInTimeframe = 120;
    if (timeframe === 'ALL') monthsInTimeframe = 36; // Default to 3 years for ALL

    const assumedSalaryPaid = Number(employee.baseSalary) * monthsInTimeframe;

    // 2. Divide Salary paid by actual hours worked
    const productivityRate = effectiveHours > 0 ? (assumedSalaryPaid / effectiveHours) : 0;

    // Static All-Time Advance logic
    const totalAdvances = employee.advances.reduce((sum, a) => sum + (Number(a.amount) - Number(a.amountRepaid)), 0);
    const monthsAdvance = Number(employee.baseSalary) > 0 ? (totalAdvances / Number(employee.baseSalary)) : 0;

    // Rating & AI-like Recommendation logic
    let rating = 5.0;
    let recommendation = "Maintain Status";
    let recommendationColor = "text-yellow-500";

    // Deduct rating for high absences
    if (absentDays > 3) rating -= 1.0;
    if (absentDays > 7) rating -= 2.0;

    // Deduct rating for extreme advances
    if (monthsAdvance > 4) rating -= 1.5;

    // Finalize recommendation
    if (rating >= 4.5 && monthsAdvance < 1) {
      recommendation = "Consider Increasing Salary / Bonus. Excellent performance.";
      recommendationColor = "text-green-500";
    } else if (rating <= 2.0) {
      recommendation = "Warning: High absences or excessive advances. Consider termination if uncorrected.";
      recommendationColor = "text-red-500";
    } else if (monthsAdvance > 4) {
      recommendation = "Do NOT approve further advances. Deduct from current salary.";
      recommendationColor = "text-orange-500";
    }

    return NextResponse.json({
      success: true,
      data: {
        employee: {
          id: employee.id,
          name: employee.name,
          role: employee.role,
          baseSalary: employee.baseSalary,
        },
        metrics: {
          rating: Math.max(1, rating).toFixed(1),
          recommendation,
          recommendationColor,
          totalAdvances,
          monthsAdvance: monthsAdvance.toFixed(1),
          presentDays,
          absentDays,
          effectiveHours,
          productivityRate
        },
        salaryHistory: employee.salaryHistory,
        advances: employee.advances, // Pass full object to construct unified feed
        attendances: employee.attendances
      }
    });
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
    const validation = OwnerEmployeeDetailPutSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { id, newSalary, reason } = validation.data;

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        baseSalary: newSalary,
        salaryHistory: {
          create: {
            date: new Date(),
            amount: newSalary,
            reason: reason || 'Salary Update'
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
