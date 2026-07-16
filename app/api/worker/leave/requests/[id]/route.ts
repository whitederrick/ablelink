// app/api/worker/leave/requests/[id]/route.ts
// 매니저 직접 등록(MANAGER_ENTRY_CONFIRM)에 대한 워커 확인/이의 응답 (Phase7).
// 확인=CONFIRMED(동의). 이의=DISPUTED(사유 필수) — 원장 정정은 매니저가 삭제/조정으로 처리(원장 불변).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

function parseId(raw: string): bigint | null {
  try { return BigInt(raw); } catch { return null; }
}

// PATCH { action: "confirm" | "dispute", reason? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const { id: raw } = await params;
    const id = parseId(raw);
    if (!id) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    if (action !== "confirm" && action !== "dispute") {
      return NextResponse.json({ success: false, message: "알 수 없는 동작입니다." }, { status: 400 });
    }
    if (action === "dispute" && !reason) {
      return NextResponse.json({ success: false, message: "이의 사유를 입력해주세요." }, { status: 400 });
    }

    const row = await prisma.annualLeaveRequest.findFirst({ where: { id, workerId } });
    if (!row) return NextResponse.json({ success: false, message: "요청을 찾을 수 없습니다." }, { status: 404 });
    if (row.kind !== "MANAGER_ENTRY_CONFIRM") {
      return NextResponse.json({ success: false, message: "확인 대상이 아닙니다." }, { status: 400 });
    }
    if (row.status !== "PENDING") {
      return NextResponse.json({ success: false, message: "이미 처리된 요청입니다." }, { status: 409 });
    }

    await prisma.annualLeaveRequest.update({
      where: { id: row.id },
      data: {
        status: action === "confirm" ? "CONFIRMED" : "DISPUTED",
        responseNote: action === "dispute" ? reason : null,
        resolvedAt: new Date(),
      },
    });

    // 담당자 알림 fan-out — 실패 비치명적.
    try {
      const dateStr = row.effectiveDate.toISOString().slice(0, 10);
      const mgrs = await prisma.manager.findMany({ where: { agencyId: row.agencyId, isActive: true }, select: { id: true } });
      if (mgrs.length > 0) {
        await prisma.managerNotice.createMany({
          data: mgrs.map((m) => ({
            managerId: m.id,
            title: `[연차 ${action === "confirm" ? "확인" : "이의"}] ${session.workerName} · ${dateStr} ${Number(row.days)}일`,
            body: action === "confirm"
              ? `${session.workerName} 직무지도원이 연차 사용 등록(${dateStr} · ${Number(row.days)}일)을 확인했습니다.`
              : `${session.workerName} 직무지도원이 연차 사용 등록(${dateStr} · ${Number(row.days)}일)에 이의를 제기했습니다.\n사유: ${reason}\n연차 관리에서 해당 사용 행을 삭제하거나 조정으로 정정해 주세요.`,
            link: "/manager/leave",
          })),
        });
      }
    } catch (e) { console.warn("[worker/leave/requests/[id]] 담당자 알림 실패:", e); }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    console.error("[worker/leave/requests/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
