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
import { isValidYmd } from "@/lib/time";

// 쓰기(POST)와 정리(DELETE)의 검증 강도를 의도적으로 나눈다.
//  · POST: isValidYmd(달력 왕복검증) — 형태검사만 하면 2026-02-31이 String 컬럼(SiteHoliday.date)에
//    verbatim 저장돼 달력에 유령 휴무가 남는다. 새 오염을 원천 차단.
//  · DELETE: 형태검사만 — 이 수정 이전에 저장된 잘못된 날짜 행(GET의 문자열 범위 조회에는 잡혀
//    화면에 보인다)을 삭제로 정리할 수 있어야 한다. DELETE는 이미 본인 배정(assignmentId)으로
//    스코프되므로 관대해도 안전하다. 여기까지 엄격하게 하면 기존 오염 행이 영구 잔존한다.
function isDateShape(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

function parseSel(sp: URLSearchParams): bigint | null {
  const raw = sp.get("assignmentId");
  try { return raw ? BigInt(raw) : null; } catch { return null; }
}

// ★멀티현장: 선택 배정(쿠키/파라미터 assignmentId)이 유효(소유+ACTIVE)하면 그 현장에 휴무를 쓰고,
//  아니면 최신 활성 배정으로 폴백. 과거엔 항상 최신 배정에 써서 선택한 현장이 아닌 다른 현장에 휴무가 기록됐다.
async function getAssignment(workerId: bigint, selId: bigint | null) {
  if (selId != null) {
    const sel = await prisma.siteAssignment.findFirst({ where: { id: selId, workerId, status: "ACTIVE" } });
    if (sel) return sel;
  }
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

    const assignment = await getAssignment(BigInt(session.workerId), parseSel(searchParams));

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
  } catch (error: unknown) {
    console.error("[worker/holidays]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { date, reason } = await request.json();
    if (!date || !isValidYmd(date)) {
      return NextResponse.json({ success: false, message: "올바른 날짜를 입력해주세요." }, { status: 400 });
    }

    const assignment = await getAssignment(BigInt(session.workerId), parseSel(new URL(request.url).searchParams));
    if (!assignment) return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });

    // 근무 인정(countAsWorkday)은 직무지도원이 정하지 않음 — 관리자가 최종 확인 시 결정.
    // 생성 시 기본 false, 이미 존재하면 관리자 결정값을 보존하고 사유만 갱신.
    await prisma.siteHoliday.upsert({
      where: { assignmentId_date: { assignmentId: assignment.id, date } },
      update: { reason: reason ?? null },
      create: { assignmentId: assignment.id, date, reason: reason ?? null, countAsWorkday: false },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("[worker/holidays]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// 근무 인정(countAsWorkday) 변경은 관리자 권한 — 직무지도원 PATCH 엔드포인트는 제거됨.
// (관리자: PATCH /api/admin/holiday-requests 에서 직접 결정)

export async function DELETE(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const sp = new URL(request.url).searchParams;
    const date = sp.get("date") ?? "";
    if (!isDateShape(date)) return NextResponse.json({ success: false, message: "올바른 날짜를 입력해주세요." }, { status: 400 });

    const assignment = await getAssignment(BigInt(session.workerId), parseSel(sp));
    if (!assignment) return NextResponse.json({ success: false, message: "배정 없음" }, { status: 404 });

    await prisma.siteHoliday.deleteMany({ where: { assignmentId: assignment.id, date } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("[worker/holidays]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
