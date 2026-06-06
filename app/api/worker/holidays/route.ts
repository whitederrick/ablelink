// app/api/worker/holidays/route.ts
// 사이트별 휴무일 등록/조회/삭제/수정 API
// GET    /api/worker/holidays?year=2026&month=5
// POST   /api/worker/holidays  { date, reason? }   ← 근무인정은 관리자가 결정
// DELETE /api/worker/holidays?date=YYYY-MM-DD

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { getKrHolidays } from "@/lib/krHolidays";
import { prisma } from "@/lib/prisma";

function isDateOnly(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function getAssignment(workerId: bigint) {
  return prisma.siteAssignment.findFirst({
    where: { workerId, status: "ACTIVE" },
    orderBy: { startDate: "desc" },
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const year  = Number(searchParams.get("year")  ?? new Date().getFullYear());
    const month = Number(searchParams.get("month") ?? new Date().getMonth() + 1);

    const assignment = await getAssignment(BigInt(session.workerId));

    // national: { date → name }, custom: { date → { reason, countAsWorkday } }
    const customHolidays: Record<string, string> = {};
    const customDetail: Record<string, { reason: string; countAsWorkday: boolean }> = {};

    if (assignment) {
      const pad = String(month).padStart(2, "0");
      const rows = await prisma.siteHoliday.findMany({
        where: { assignmentId: assignment.id, date: { gte: `${year}-${pad}-01`, lte: `${year}-${pad}-31` } },
        select: { date: true, reason: true, countAsWorkday: true },
      });
      for (const r of rows) {
        customHolidays[r.date] = r.reason ?? "휴무";
        customDetail[r.date]   = { reason: r.reason ?? "휴무", countAsWorkday: r.countAsWorkday };
      }
    }

    return NextResponse.json({
      success: true,
      national: getKrHolidays(year, month),
      custom: customHolidays,
      customDetail, // countAsWorkday 포함 상세 정보
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

    const assignment = await getAssignment(BigInt(session.workerId));
    if (!assignment) return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });

    // 근무 인정(countAsWorkday)은 직무지도원이 정하지 않음 — 관리자가 최종 확인 시 결정.
    // 생성 시 기본 false, 이미 존재하면 관리자 결정값을 보존하고 사유만 갱신.
    await prisma.siteHoliday.upsert({
      where: { assignmentId_date: { assignmentId: assignment.id, date } },
      update: { reason: reason ?? null },
      create: { assignmentId: assignment.id, date, reason: reason ?? null, countAsWorkday: false },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// 근무 인정(countAsWorkday) 변경은 관리자 권한 — 직무지도원 PATCH 엔드포인트는 제거됨.
// (관리자: PATCH /api/admin/holiday-requests 에서 직접 결정)

export async function DELETE(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!isDateOnly(date)) return NextResponse.json({ success: false, message: "올바른 날짜를 입력해주세요." }, { status: 400 });

    const assignment = await getAssignment(BigInt(session.workerId));
    if (!assignment) return NextResponse.json({ success: false, message: "배정 없음" }, { status: 404 });

    await prisma.siteHoliday.deleteMany({ where: { assignmentId: assignment.id, date } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
