// app/api/admin/leave/requests/[id]/route.ts
// 워커 연차 신청(WORKER_REQUEST) 승인/반려 (Phase7) — 매니저 전용.
// 승인 = $transaction(잔여 재검증 → USE 원장 생성 → 요청 APPROVED + ledgerEntryId). 반려 = 사유 필수.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { audit } from "@/lib/audit";

// PATCH { action: "approve" | "reject", reason? }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id: raw } = await params;
    const id = parseBigInt(raw);
    if (!id) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ success: false, message: "알 수 없는 동작입니다." }, { status: 400 });
    }
    if (action === "reject" && !reason) {
      return NextResponse.json({ success: false, message: "반려 사유를 입력해주세요." }, { status: 400 });
    }

    const row = await prisma.annualLeaveRequest.findFirst({ where: { id, agencyId: scope.agencyId } });
    if (!row) return NextResponse.json({ success: false, message: "신청을 찾을 수 없습니다." }, { status: 404 });
    if (row.kind !== "WORKER_REQUEST") {
      return NextResponse.json({ success: false, message: "승인/반려 대상이 아닙니다." }, { status: 400 });
    }
    if (row.status !== "PENDING") {
      return NextResponse.json({ success: false, message: "이미 처리된 신청입니다." }, { status: 409 });
    }

    const days = Number(row.days);
    const dateStr = row.effectiveDate.toISOString().slice(0, 10);

    if (action === "reject") {
      await prisma.annualLeaveRequest.update({
        where: { id: row.id },
        data: { status: "REJECTED", responseNote: reason, resolvedByManagerId: scope.managerId, resolvedAt: new Date() },
      });
      await audit(scope, {
        entityType: "AnnualLeave", entityId: row.id.toString(), action: "update",
        summary: `연차 신청 반려 ${days}일 (${dateStr}) — worker ${row.workerId}`,
        payload: { requestId: row.id.toString(), workerId: row.workerId.toString(), days, effectiveDate: dateStr, reason },
      });
      try {
        await prisma.workerNotice.create({
          data: {
            workerId: row.workerId, agencyId: scope.agencyId,
            title: "연차 신청이 반려되었습니다",
            body: `${dateStr} · ${days}일 연차 신청이 반려되었습니다.\n사유: ${reason}`,
            type: "REJECT", kind: "NOTICE_INDIVIDUAL", link: "/worker/leave",
          },
        });
      } catch (e) { console.warn("[admin/leave/requests] 반려 알림 실패:", e); }
      return NextResponse.json({ success: true });
    }

    // 승인 — 잔여 재검증과 원장 생성·요청 갱신을 한 트랜잭션으로(신청 시점 검증만 믿지 않음).
    let entryId: bigint;
    try {
      entryId = await prisma.$transaction(async (tx) => {
        const agg = await tx.annualLeaveEntry.aggregate({
          where: { agencyId: scope.agencyId, workerId: row.workerId }, _sum: { days: true },
        });
        const balance = Number(agg._sum.days ?? 0);
        if (balance < days) throw new Error(`INSUFFICIENT:${balance}`);
        const entry = await tx.annualLeaveEntry.create({
          data: {
            agencyId: scope.agencyId, workerId: row.workerId, kind: "USE", days: -days,
            effectiveDate: row.effectiveDate,
            memo: `연차 신청 승인${row.reason ? ` — ${row.reason}` : ""}`,
            createdByManagerId: scope.managerId,
          },
          select: { id: true },
        });
        await tx.annualLeaveRequest.update({
          where: { id: row.id },
          data: { status: "APPROVED", ledgerEntryId: entry.id, resolvedByManagerId: scope.managerId, resolvedAt: new Date() },
        });
        return entry.id;
      });
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message.match(/^INSUFFICIENT:(.+)$/) : null;
      if (m) return NextResponse.json({ success: false, message: `잔여 연차(${m[1]}일)가 부족합니다.` }, { status: 409 });
      throw e;
    }

    await audit(scope, {
      entityType: "AnnualLeave", entityId: entryId.toString(), action: "create",
      summary: `연차 신청 승인 ${days}일 (${dateStr}) — worker ${row.workerId}`,
      payload: { requestId: row.id.toString(), workerId: row.workerId.toString(), days, effectiveDate: dateStr },
    });
    try {
      await prisma.workerNotice.create({
        data: {
          workerId: row.workerId, agencyId: scope.agencyId,
          title: "연차 신청이 승인되었습니다",
          body: `${dateStr} · ${days}일 연차 신청이 승인되었습니다.\n캘린더와 내 연차에서 확인할 수 있습니다.`,
          type: "INFO", kind: "NOTICE_INDIVIDUAL", link: "/worker/leave",
        },
      });
    } catch (e) { console.warn("[admin/leave/requests] 승인 알림 실패:", e); }

    return NextResponse.json({ success: true, entryId: entryId.toString() });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/leave/requests/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
