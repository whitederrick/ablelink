// app/api/admin/leave/[workerId]/route.ts
// 연차 원장 상세(GET) + 사용/조정 등록(POST) + 수동 행 삭제(DELETE) — 매니저 전용.
// 원장은 append-only가 원칙이나, 매니저 오입력 정정을 위해 '본인 기관 수동 행(USE/ADJUST)'만 삭제 허용(감사로그).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { workerBelongsToAgency } from "@/lib/worker/agencyScope";
import { computeLedgerState, type LedgerEntry } from "@/lib/leave/accrual";
import { audit } from "@/lib/audit";
import { withWorkerAssignmentLock } from "@/lib/assignmentLock";

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const KIND_LABEL: Record<string, string> = {
  ACCRUAL_MONTHLY: "발생(월 개근)", ACCRUAL_ANNUAL: "발생(연차년도)", USE: "사용", EXPIRE: "소멸", PAYOUT: "수당 정산", ADJUST: "조정",
};

async function loadLedger(agencyId: bigint, workerId: bigint) {
  const rows = await prisma.annualLeaveEntry.findMany({
    where: { agencyId, workerId },
    orderBy: [{ effectiveDate: "asc" }, { id: "asc" }],
    select: {
      id: true, kind: true, days: true, effectiveDate: true, expiresAt: true,
      sourceLabel: true, memo: true, createdByManagerId: true, createdAt: true,
    },
  });
  const ledger: LedgerEntry[] = rows.map((r) => ({
    id: r.id.toString(), kind: r.kind as LedgerEntry["kind"], days: Number(r.days),
    effectiveDate: isoOf(r.effectiveDate), expiresAt: r.expiresAt ? isoOf(r.expiresAt) : null,
  }));
  return { rows, state: computeLedgerState(ledger) };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ workerId: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { workerId: raw } = await params;
    const workerId = parseBigInt(raw);
    if (!workerId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    if (!(await workerBelongsToAgency(workerId, scope.agencyId))) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const [worker, firstContract, latestContract] = await Promise.all([
      prisma.worker.findUnique({ where: { id: workerId }, select: { workerName: true, loginId: true } }),
      prisma.employmentContract.findFirst({ where: { agencyId: scope.agencyId, workerId }, orderBy: { contractStart: "asc" }, select: { contractStart: true } }),
      prisma.employmentContract.findFirst({
        where: { agencyId: scope.agencyId, workerId }, orderBy: { contractStart: "desc" },
        select: { workStartTime: true, workEndTime: true, breakStartTime: true, breakEndTime: true },
      }),
    ]);
    // 1일 소정근로시간(분) — 미사용수당 1일치 금액(통상시급×1일소정) 제안용. 계약 시각 없으면 null(수동 입력).
    const cMin = (t?: string | null) => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
    const _cs = cMin(latestContract?.workStartTime), _ce = cMin(latestContract?.workEndTime), _cbs = cMin(latestContract?.breakStartTime), _cbe = cMin(latestContract?.breakEndTime);
    const dailySojeMinutes = (_cs != null && _ce != null && _ce > _cs)
      ? Math.max(0, (_ce - _cs) - (_cbs != null && _cbe != null && _cbe > _cbs ? _cbe - _cbs : 0))
      : null;
    const { rows, state } = await loadLedger(scope.agencyId, workerId);
    const remainingByGrant = new Map(state.grants.map((g) => [g.id, g]));

    return NextResponse.json({
      success: true,
      worker: { name: worker?.workerName ?? "-", loginId: worker?.loginId ?? "" },
      hireDate: firstContract ? isoOf(firstContract.contractStart) : null,
      balance: state.balance,
      dailySojeMinutes,
      // 부여분별 잔량·만료(모달 요약) — 잔량 있는 것만
      grants: state.grants.filter((g) => g.remaining > 0).map((g) => ({ id: g.id, remaining: g.remaining, expiresAt: g.expiresAt })),
      entries: rows.map((r) => ({
        id: r.id.toString(),
        kind: r.kind, kindLabel: KIND_LABEL[r.kind] ?? r.kind,
        days: Number(r.days),
        effectiveDate: isoOf(r.effectiveDate),
        expiresAt: r.expiresAt ? isoOf(r.expiresAt) : null,
        sourceLabel: r.sourceLabel,
        memo: r.memo,
        manual: r.createdByManagerId != null,
        deletable: r.createdByManagerId != null && (r.kind === "USE" || r.kind === "ADJUST"),
        remaining: r.kind.startsWith("ACCRUAL") ? (remainingByGrant.get(r.id.toString())?.remaining ?? 0) : null,
      })),
    });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/leave/[workerId] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// POST { action: "use" | "adjust", days, effectiveDate: "YYYY-MM-DD", memo? }
//  use: days>0(내부 저장은 -days). 잔여 초과 사용은 409(선사용 금지 — 필요 시 adjust로 부여 후 사용).
//  adjust: days != 0(± 자유), memo 필수(감사 증빙).
export async function POST(req: NextRequest, { params }: { params: Promise<{ workerId: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { workerId: raw } = await params;
    const workerId = parseBigInt(raw);
    if (!workerId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    if (!(await workerBelongsToAgency(workerId, scope.agencyId))) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const days = Number(body?.days);
    const effectiveDate = String(body?.effectiveDate ?? "").trim();
    const memo = typeof body?.memo === "string" ? body.memo.trim().slice(0, 200) : "";
    // 형식 + 실존 날짜 검증(P3) — 정규식만으로는 2026-99-99가 통과해 Invalid Date로 500이 났다.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || isNaN(Date.parse(`${effectiveDate}T00:00:00.000Z`))) {
      return NextResponse.json({ success: false, message: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (!Number.isFinite(days) || Math.abs(days) > 30 || Math.round(days * 4) !== days * 4) {
      // 0.25일 단위까지 허용(반차·반반차), 상한 30(오입력 방어)
      return NextResponse.json({ success: false, message: "일수는 0.25일 단위, 최대 30일입니다." }, { status: 400 });
    }

    if (action === "use") {
      if (days <= 0) return NextResponse.json({ success: false, message: "사용 일수는 0보다 커야 합니다." }, { status: 400 });
      const effUtc = new Date(`${effectiveDate}T00:00:00.000Z`);
      // Phase7: 매니저 직접 등록도 유효하되 직무지도원 확인(동의) 플로 필수 — 원장 USE와 확인 요청을 한 트랜잭션으로.
      //  감사 P2: 잔여 검증·중복 검사·원장 생성을 워커 단위 advisory 락으로 직렬화(승인 라우트와 동일 chokepoint)
      //  → 동시 등록/승인 간 잔여 초과·같은날 이중 USE 차단.
      let created: { id: bigint };
      try {
        created = await withWorkerAssignmentLock(workerId, async (tx) => {
          const dupUse = await tx.annualLeaveEntry.findFirst({
            where: { agencyId: scope.agencyId, workerId, kind: "USE", effectiveDate: effUtc },
            select: { id: true },
          });
          if (dupUse) throw new Error("DUP_USE");
          const agg = await tx.annualLeaveEntry.aggregate({
            where: { agencyId: scope.agencyId, workerId }, _sum: { days: true },
          });
          const balance = Number(agg._sum.days ?? 0);
          if (balance < days) throw new Error(`INSUFFICIENT:${balance}`);
          const entry = await tx.annualLeaveEntry.create({
            data: {
              agencyId: scope.agencyId, workerId, kind: "USE", days: -days,
              effectiveDate: effUtc, memo: memo || null, createdByManagerId: scope.managerId,
            },
            select: { id: true },
          });
          await tx.annualLeaveRequest.create({
            data: {
              agencyId: scope.agencyId, workerId, kind: "MANAGER_ENTRY_CONFIRM", status: "PENDING",
              effectiveDate: effUtc, days,
              reason: memo || null, ledgerEntryId: entry.id, createdByManagerId: scope.managerId,
            },
          });
          return entry;
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "DUP_USE") return NextResponse.json({ success: false, message: "해당 날짜에 이미 등록된 연차가 있습니다." }, { status: 409 });
        const m = msg.match(/^INSUFFICIENT:(.+)$/);
        if (m) return NextResponse.json({ success: false, message: `잔여 연차(${m[1]}일)가 부족합니다.` }, { status: 409 });
        throw e;
      }
      // 워커 확인 요청 알림 — 실패 비치명적.
      try {
        await prisma.workerNotice.create({
          data: {
            workerId, agencyId: scope.agencyId,
            title: "연차 사용 등록 확인 요청",
            body: `담당자가 연차 사용을 등록했습니다.\n사용일 ${effectiveDate} · ${days}일${memo ? `\n메모: ${memo}` : ""}\n내 연차에서 확인 또는 이의를 선택해 주세요.`,
            type: "INFO", kind: "NOTICE_INDIVIDUAL", link: "/worker/leave",
          },
        });
      } catch (e) { console.warn("[admin/leave] 워커 확인요청 알림 실패:", e); }
      await audit(scope, {
        entityType: "AnnualLeave", entityId: created.id.toString(), action: "create",
        summary: `연차 사용 등록 ${days}일 (${effectiveDate}) — worker ${workerId}`,
        payload: { workerId: workerId.toString(), days, effectiveDate, memo },
      });
      return NextResponse.json({ success: true, id: created.id.toString() });
    }

    if (action === "adjust") {
      if (days === 0) return NextResponse.json({ success: false, message: "조정 일수는 0이 될 수 없습니다." }, { status: 400 });
      if (!memo) return NextResponse.json({ success: false, message: "조정 사유를 입력해주세요." }, { status: 400 });
      const created = await prisma.annualLeaveEntry.create({
        data: {
          agencyId: scope.agencyId, workerId, kind: "ADJUST", days,
          effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`),
          memo, createdByManagerId: scope.managerId,
        },
        select: { id: true },
      });
      await audit(scope, {
        entityType: "AnnualLeave", entityId: created.id.toString(), action: "create",
        summary: `연차 수동 조정 ${days > 0 ? "+" : ""}${days}일 (${effectiveDate}) — worker ${workerId}`,
        payload: { workerId: workerId.toString(), days, effectiveDate, memo },
      });
      return NextResponse.json({ success: true, id: created.id.toString() });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 동작입니다." }, { status: 400 });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/leave/[workerId] POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// DELETE ?entryId= — 본 기관 '수동 행(USE/ADJUST, 매니저 생성)'만 삭제(오입력 정정). 시스템 행은 불가.
//  주의: 과거 USE가 월 개근(연차 사용일=출근 간주)에 기여한 뒤 삭제해도 이미 발생한 부여는 회수하지 않는다
//  (dedup 멱등 원장 — 필요 시 매니저가 ADJUST로 정정, 감사로그로 추적).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ workerId: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { workerId: raw } = await params;
    const workerId = parseBigInt(raw);
    const entryId = parseBigInt(new URL(req.url).searchParams.get("entryId"));
    if (!workerId || !entryId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    if (!(await workerBelongsToAgency(workerId, scope.agencyId))) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }
    const row = await prisma.annualLeaveEntry.findFirst({
      where: { id: entryId, agencyId: scope.agencyId, workerId },
    });
    if (!row) return NextResponse.json({ success: false, message: "항목을 찾을 수 없습니다." }, { status: 404 });
    if (row.createdByManagerId == null || (row.kind !== "USE" && row.kind !== "ADJUST")) {
      return NextResponse.json({ success: false, message: "자동 생성 항목은 삭제할 수 없습니다. 조정으로 정정해주세요." }, { status: 409 });
    }
    const before: Record<string, unknown> = {
      kind: row.kind, days: Number(row.days), effectiveDate: isoOf(row.effectiveDate),
      memo: row.memo, sourceLabel: row.sourceLabel, workerId: row.workerId.toString(),
    };
    await prisma.$transaction(async (tx) => {
      await tx.annualLeaveEntry.delete({ where: { id: row.id } });
      // Phase7: 이 원장 행에 연동된 신청/확인 요청은 무효화(CANCELED) — 워커 화면 잔존 방지.
      await tx.annualLeaveRequest.updateMany({
        where: { ledgerEntryId: row.id, status: { in: ["PENDING", "APPROVED", "CONFIRMED", "DISPUTED"] } },
        data: { status: "CANCELED", resolvedAt: new Date() },
      });
    });
    await audit(scope, {
      entityType: "AnnualLeave", entityId: row.id.toString(), action: "delete",
      summary: `연차 ${row.kind === "USE" ? "사용" : "조정"} 행 삭제(${Number(row.days)}일, ${isoOf(row.effectiveDate)}) — worker ${workerId}`,
      before,
    });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error("[admin/leave/[workerId] DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
