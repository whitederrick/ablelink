// app/api/worker/holidays/route.ts
// 사이트별 휴무일 등록/조회/삭제 API
// GET  /api/worker/holidays?year=2026&month=5
// POST /api/worker/holidays  { date: "YYYY-MM-DD", reason?: string }
// DELETE /api/worker/holidays?date=YYYY-MM-DD

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { getKrHolidays } from "@/lib/krHolidays";
import { prisma } from "@/lib/prisma";

function isDateOnly(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const year  = Number(searchParams.get("year")  ?? new Date().getFullYear());
    const month = Number(searchParams.get("month") ?? new Date().getMonth() + 1);

    const userId = BigInt(session.userId);
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    });

    const customHolidays: Record<string, string> = {};
    if (assignment) {
      const pad = String(month).padStart(2, "0");
      const from = `${year}-${pad}-01`;
      const to   = `${year}-${pad}-31`;
      const rows = await prisma.siteHoliday.findMany({
        where: { assignmentId: assignment.id, date: { gte: from, lte: to } },
        select: { date: true, reason: true },
      });
      for (const r of rows) {
        customHolidays[r.date] = r.reason ?? "휴무";
      }
    }

    return NextResponse.json({
      success: true,
      national: getKrHolidays(year, month),
      custom: customHolidays,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { date, reason } = await request.json();
    if (!date || !isDateOnly(date)) {
      return NextResponse.json({ success: false, message: "올바른 날짜를 입력해주세요." }, { status: 400 });
    }

    const userId = BigInt(session.userId);
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    });
    if (!assignment) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });
    }

    await prisma.siteHoliday.upsert({
      where: { assignmentId_date: { assignmentId: assignment.id, date } },
      update: { reason: reason ?? null },
      create: { assignmentId: assignment.id, date, reason: reason ?? null },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? "";
    if (!isDateOnly(date)) {
      return NextResponse.json({ success: false, message: "올바른 날짜를 입력해주세요." }, { status: 400 });
    }

    const userId = BigInt(session.userId);
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    });
    if (!assignment) return NextResponse.json({ success: false, message: "배정 없음" }, { status: 404 });

    await prisma.siteHoliday.deleteMany({
      where: { assignmentId: assignment.id, date },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
