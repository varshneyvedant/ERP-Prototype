import { getServerSession, authOptions } from '@/lib/mock-session';
﻿export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';


import { prisma } from '@/lib/prisma';
import { startOfDay, endOfDay, subDays } from 'date-fns';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as any).role?.toLowerCase();
  if (role !== 'manager' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const today = new Date();
    const startOfToday = startOfDay(today);
    const endOfToday = endOfDay(today);
    const startOfWeek = startOfDay(subDays(today, 7));
    const startOf30Days = startOfDay(subDays(today, 30));

    // 1. Raw Copper Stock Level (Always current total balance)
    const totalPurchasedObj = await prisma.purchase.aggregate({ where: { isDeleted: false }, _sum: { qty: true } });
    const totalProducedObj = await prisma.production.aggregate({ where: { isDeleted: false }, _sum: { rawCopperUsed: true } });
    const totalSoldRawObj = await prisma.saleItem.aggregate({ where: { sale: { isDeleted: false }, productCategory: 'Raw Copper Bundle' }, _sum: { qty: true } });
    const rawCopperStock = Number(totalPurchasedObj._sum.qty || 0) - (Number(totalProducedObj._sum.rawCopperUsed || 0) + Number(totalSoldRawObj._sum.qty || 0));

    // 2. Production Metrics
    const productionToday = await prisma.production.aggregate({
      where: { isDeleted: false, date: { gte: startOfToday, lte: endOfToday } },
      _sum: { wireProduced: true }
    });

    const productionWeek = await prisma.production.aggregate({
      where: { isDeleted: false, date: { gte: startOfWeek, lte: endOfToday } },
      _sum: { wireProduced: true }
    });

    // 3. Attendance Metrics
    const activeWorkers = await prisma.employee.count({ where: { role: { not: 'Manager' } } });
    const attendanceToday = await prisma.attendance.findMany({
      where: { date: { gte: startOfToday, lte: endOfToday } }
    });
    
    const presentCount = attendanceToday.filter(a => a.status === 'Present').length;
    const absentCount = attendanceToday.filter(a => a.status === 'Absent').length;
    const halfDayCount = attendanceToday.filter(a => a.status === 'Half_day').length;

    // 4. Production Yield % (Last 30 Days)
    const totalProd30Days = await prisma.production.aggregate({
      where: { isDeleted: false, date: { gte: startOf30Days, lte: endOfToday } },
      _sum: { rawCopperUsed: true, wireProduced: true }
    });
    const yieldPercent = totalProd30Days._sum.rawCopperUsed
      ? (Number(totalProd30Days._sum.wireProduced || 0) / Number(totalProd30Days._sum.rawCopperUsed)) * 100
      : 0;

    // 5. Recent Production Runs (Limit 5)
    const recentProductions = await prisma.production.findMany({
      where: { isDeleted: false },
      orderBy: { date: 'desc' },
      take: 5
    });

    // 6. Finished Goods Low Stock Alerts (< 0.50 Tons / 500 Kg)
    const batches = await prisma.finishedGoodsBatch.findMany({
      where: { remainingQty: { gt: 0 } },
      select: { productCategory: true, brand: true, wireType: true, remainingQty: true }
    });

    const stockMap: Record<string, { productCategory: string; brand: string; wireType: string; totalStock: number }> = {};
    batches.forEach(b => {
      const key = `${b.productCategory}_${b.brand || 'Unbranded'}_${b.wireType}`;
      if (!stockMap[key]) {
        stockMap[key] = {
          productCategory: b.productCategory,
          brand: b.brand || 'Unbranded',
          wireType: b.wireType,
          totalStock: 0
        };
      }
      stockMap[key].totalStock += Number(b.remainingQty);
    });

    const lowFinishedGoodsAlerts = Object.values(stockMap).filter(item => item.totalStock < 0.50);

    return NextResponse.json({
      success: true,
      data: {
        rawCopperStock,
        isRawCopperLow: rawCopperStock < 5.00,
        lowFinishedGoodsAlerts,
        productionToday: Number(productionToday._sum.wireProduced || 0),
        productionWeek: Number(productionWeek._sum.wireProduced || 0),
        attendance: {
          total: activeWorkers,
          present: presentCount,
          absent: absentCount,
          halfDay: halfDayCount,
          logged: attendanceToday.length > 0
        },
        yield30Days: yieldPercent,
        recentProductions
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Database transaction failed' }, { status: 500 });
  }
}
