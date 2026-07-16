// app/api/worker/leave/requests/route.ts
// 연차 신청(Phase7) — 워커 본인 신청 목록(GET) + 신청 생성(POST, WORKER_REQUEST).
// 승인/반려는 매니저(/api/admin/leave/requests)가 처리. 원장(USE)은 승인 시점에만 생성.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { workerBelongsToAgency } from "@/lib/worker/agencyScope";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CONFIRMED: "확인", DISPUTED: "이의", CANCELED: "취소",
};

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const rows = await prisma.annualLeaveRequest.findMany({
      where: { workerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true, agencyId: true, kind: true, status: true, effectiveDate: true, days: true,
        reason: true, responseNote: true, createdAt: true, resolvedAt: true,
        agency: { select: { name: true } },
      },
    });
    return NextResponse.json({
      success: true,
      items: rows.map((r) => ({
        id: r.id.toString(),
        agencyId: r.agencyId.toString(),
        agencyName: r.agency?.name ?? "-",
        kind: r.kind,
        status: r.status,
        statusLabel: STATUS_LABEL[r.status] ?? r.status,
        effectiveDate: r.effectiveDate.toISOString().slice(0, 10),
        days: Number(r.days),
        reason: r.reason,
        responseNote: r.responseNote,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e: unknown) {
    console.error("[worker/leave/requests GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// POST { agencyId, effectiveDate: "YYYY-MM-DD", days, reason? } — 연차 사용 신청.
//  검증: 소속 기관(403)·0.25일 단위·잔여 초과 400·같은 날짜 중복 신청/기등록 409(멱등).
export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const body = await req.json().catch(() => ({}));
    let agencyId: bigint;
    try { agencyId = BigInt(String(body?.agencyId ?? "")); } catch { return NextResponse.json({ success: false, message: "기관 정보가 올바르지 않습니다." }, { status: 400 }); }
    const effectiveDate = String(body?.effectiveDate ?? "").trim();
    const days = Number(body?.days);
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return NextResponse.json({ success: false, message: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (!Number.isFinite(days) || days <= 0 || days > 30 || Math.round(days * 4) !== days * 4) {
      return NextResponse.json({ success: false, message: "일수는 0.25일 단위, 최대 30일입니다." }, { status: 400 });
    }
    if (!(await workerBelongsToAgency(workerId, agencyId))) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    // 잔여 검증(부호합) — 선사용 신청 차단(승인 시점에도 재검증하므로 이건 UX용 1차 방어).
    const agg = await prisma.annualLeaveEntry.aggregate({
      where: { agencyId, workerId }, _sum: { days: true },
    });
    const balance = Number(agg._sum.days ?? 0);
    if (balance < days) {
      return NextResponse.json({ success: false, message: `잔여 연차(${balance}일)가 부족합니다.` }, { status: 400 });
    }

    const dateUtc = new Date(`${effectiveDate}T00:00:00.000Z`);
    // 같은 날짜 처리 대기 신청 중복 방지(409) — holiday-requests와 동일한 애플리케이션 레벨 멱등.
    const dupReq = await prisma.annualLeaveRequest.findFirst({
      where: { workerId, agencyId, effectiveDate: dateUtc, status: "PENDING" },
      select: { id: true },
    });
    if (dupReq) return NextResponse.json({ success: false, message: "이미 처리 대기 중인 신청이 있습니다." }, { status: 409 });
    // 같은 날짜에 이미 등록(원장 USE)된 연차가 있으면 안내(409).
    const dupUse = await prisma.annualLeaveEntry.findFirst({
      where: { workerId, agencyId, kind: "USE", effectiveDate: dateUtc },
      select: { id: true },
    });
    if (dupUse) return NextResponse.json({ success: false, message: "해당 날짜에 이미 등록된 연차가 있습니다." }, { status: 409 });

    const created = await prisma.annualLeaveRequest.create({
      data: {
        agencyId, workerId, kind: "WORKER_REQUEST", status: "PENDING",
        effectiveDate: dateUtc, days, reason: reason || null,
      },
      select: { id: true },
    });

    // 담당자 알림 fan-out(다중 담당자) — 실패해도 신청 자체는 유효(비치명적).
    try {
      const mgrs = await prisma.manager.findMany({ where: { agencyId, isActive: true }, select: { id: true } });
      if (mgrs.length > 0) {
        await prisma.managerNotice.createMany({
          data: mgrs.map((m) => ({
            managerId: m.id,
            title: `[연차 신청] ${session.workerName} · ${effectiveDate} ${days}일`,
            body: `${session.workerName} 직무지도원이 연차 사용을 신청했습니다.\n사용일 ${effectiveDate} · ${days}일${reason ? `\n사유: ${reason}` : ""}\n연차 관리에서 승인 또는 반려해 주세요.`,
            link: "/manager/leave",
          })),
        });
      }
    } catch (e) { console.warn("[worker/leave/requests] 담당자 알림 실패:", e); }

    return NextResponse.json({ success: true, id: created.id.toString() });
  } catch (e: unknown) {
    console.error("[worker/leave/requests POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
