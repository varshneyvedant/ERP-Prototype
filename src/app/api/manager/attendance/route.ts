import { getServerSession, authOptions } from '@/lib/mock-session';
import { ManagerAttendancePostSchema } from '@/lib/validations';
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
    const validation = ManagerAttendancePostSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid data", details: validation.error.format() }, { status: 400 });
    }
    const { attendance, date } = validation.data;
    const recordDate = date ? new Date(date) : new Date();

    for (const empId of Object.keys(attendance)) {
        const data = attendance[empId];
        if (data.status === 'Custom' && (Number(data.hours) > 24 || Number(data.hours) < 0)) {
            return NextResponse.json({ error: 'Hours worked cannot exceed 24 or be less than 0' }, { status: 400 });
        }
    }

    const creates = Object.keys(attendance).map(empId => {
      const data = attendance[empId];
      return prisma.attendance.create({
        data: {
          employeeId: empId,
          date: recordDate,
          status: data.status,
          hoursWorked: data.status === 'Custom' ? Number(data.hours) : null
        }
      });
    });

    await prisma.$transaction(creates);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
