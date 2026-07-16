// app/api/admin/leave/requests/[id]/route.ts
// 워커 연차 신청(WORKER_REQUEST) 승인/반려 (Phase7) — 매니저 전용.
// 승인 = $transaction(잔여 재검증 → USE 원장 생성 → 요청 APPROVED + ledgerEntryId). 반려 = 사유 필수.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { withWorkerAssignmentLock } from "@/lib/assignmentLock";

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
      // 상태 전이(PENDING→REJECTED)를 승인과 '같은 워커 락' 안에서 원자화 — 승인↔반려 동시 교차 시
      //  둘이 상호 배제되어(먼저 락 잡은 쪽만 성공) 한쪽은 확실히 409. (락 밖 updateMany만으론 승인 트랜잭션과
      //  직렬화되지 않아 반려 성공 후 승인이 덮어써 둘 다 200이 되던 문제 방지)
      const claimedCount = await withWorkerAssignmentLock(row.workerId, async (tx) => {
        const upd = await tx.annualLeaveRequest.updateMany({
          where: { id: row.id, agencyId: scope.agencyId, kind: "WORKER_REQUEST", status: "PENDING" },
          data: { status: "REJECTED", responseNote: reason, resolvedByManagerId: scope.managerId, resolvedAt: new Date() },
        });
        return upd.count;
      });
      if (claimedCount === 0) return NextResponse.json({ success: false, message: "이미 처리된 신청입니다." }, { status: 409 });
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

    // 승인 — 워커 단위 advisory 락으로 직렬화(감사 P2: read-then-write 이중 승인 → USE 이중 차감 차단).
    //  락 안에서: ①상태 재확인(PENDING만) ②같은 날짜 기존 USE 중복 검사(워커 신청 racing 방어)
    //  ③잔여 재검증 ④USE 생성 ⑤요청 APPROVED. 같은 워커의 동시 승인·직접등록이 전부 이 락으로 순차화된다.
    //  (sentinel 문자열로 락 밖에서 상태코드 매핑)
    let entryId: bigint;
    try {
      entryId = await withWorkerAssignmentLock(row.workerId, async (tx) => {
        const fresh = await tx.annualLeaveRequest.findFirst({
          where: { id: row.id, agencyId: scope.agencyId, kind: "WORKER_REQUEST" },
          select: { status: true },
        });
        if (!fresh || fresh.status !== "PENDING") throw new Error("ALREADY_PROCESSED");
        const dupUse = await tx.annualLeaveEntry.findFirst({
          where: { agencyId: scope.agencyId, workerId: row.workerId, kind: "USE", effectiveDate: row.effectiveDate },
          select: { id: true },
        });
        if (dupUse) throw new Error("DUP_USE");
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
      const msg = e instanceof Error ? e.message : "";
      if (msg === "ALREADY_PROCESSED") return NextResponse.json({ success: false, message: "이미 처리된 신청입니다." }, { status: 409 });
      if (msg === "DUP_USE") return NextResponse.json({ success: false, message: "해당 날짜에 이미 등록된 연차가 있습니다." }, { status: 409 });
      const m = msg.match(/^INSUFFICIENT:(.+)$/);
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
