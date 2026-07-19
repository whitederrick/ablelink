// app/api/admin/payroll/runs/[runId]/route.ts
// GET: 상세 / PATCH: 항목 수동 수정 / POST: 확정

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { PayrollBreakdown } from "@/lib/payroll/breakdown";
import { parseBigInt } from "@/lib/adminScope";

function itemDto(i: any) {
  return {
    id: i.id.toString(),
    workerId: i.workerId.toString(),
    workerName: i.user?.workerName ?? "-",
    loginId: i.user?.loginId ?? "",
    grossPay: Number(i.grossPay),
    totalDeduction: Number(i.totalDeduction),
    netPay: Number(i.netPay),
    workedDays: i.workedDays ?? 0,
    workedMinutes: i.workedMinutes ?? 0,
    breakdown: i.breakdown ?? {},
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { runId } = await params;
    const runIdBig = parseBigInt(runId);
    if (!runIdBig) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const run = await prisma.payrollRun.findUnique({
      where: { id: runIdBig },
      include: {
        items: {
          include: { user: { select: { id: true, workerName: true, loginId: true } } },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!run) return NextResponse.json({ success: false, message: "없음" }, { status: 404 });
    if (scope.agencyId && run.agencyId !== scope.agencyId) {
      return NextResponse.json({ success: false, message: "접근 불가" }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: run.id.toString(),
        yearMonth: run.yearMonth,
        status: run.status,
        createdAt: run.createdAt.toISOString(),
        finalizedAt: run.finalizedAt?.toISOString() ?? null,
        items: run.items.map(itemDto),
        totalGrossPay: run.items.reduce((s, i) => s + Number(i.grossPay), 0),
        totalDeduction: run.items.reduce((s, i) => s + Number(i.totalDeduction), 0),
        totalNetPay: run.items.reduce((s, i) => s + Number(i.netPay), 0),
      },
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// PATCH: 항목 수동 수정 — 그리드 라인아이템(payLines/deductLines/basicInfo) 저장 + 합계 재계산.
//   (레거시: grossPay/totalDeduction 직접 입력도 지원, breakdown 보존)
function s(v: any, max = 40) { return String(v ?? "").slice(0, max); }
function num(v: any) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; }
function hrs(v: any) { const n = Number(v); return Number.isFinite(n) ? +n.toFixed(1) : 0; }

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { runId } = await params;
    const runIdBig = parseBigInt(runId);
    if (!runIdBig) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const run = await prisma.payrollRun.findUnique({ where: { id: runIdBig } });
    if (!run) return NextResponse.json({ success: false, message: "없음" }, { status: 404 });
    if (scope.agencyId && run.agencyId !== scope.agencyId) {
      return NextResponse.json({ success: false, message: "접근 불가" }, { status: 403 });
    }
    if (run.status === "FINALIZED") {
      return NextResponse.json({ success: false, message: "확정된 급여는 수정할 수 없습니다." }, { status: 409 });
    }

    const body = await req.json();
    const itemIdBig = parseBigInt(body.itemId);
    if (!itemIdBig) return NextResponse.json({ success: false, message: "잘못된 항목 ID입니다." }, { status: 400 });

    // IDOR 방지: itemId가 실제 이 run 소속인지 검증 + 기존 breakdown 보존
    const existingItem = await prisma.payrollItem.findUnique({
      where: { id: itemIdBig },
      select: { runId: true, workerId: true, breakdown: true },
    });
    if (!existingItem || existingItem.runId !== run.id) {
      return NextResponse.json({ success: false, message: "접근 불가" }, { status: 403 });
    }
    const prevBd = (existingItem.breakdown ?? {}) as PayrollBreakdown;

    // 연차 미사용수당 정산(옵션): 그리드 저장과 연차 원장 PAYOUT 기록을 트랜잭션으로 원자 처리.
    //  이중지급 방어 — ①원장 잔여 검증(정산분만큼 차감돼 재정산 자동 차단) ②이 급여 항목으로 이미
    //  정산했으면 409(더블클릭·재저장 방어). 검증은 아래 트랜잭션 안(워커 advisory 락)에서 수행해
    //  연차 승인/직접등록(withWorkerAssignmentLock)·동시 재저장과 상호배제한다. 정정은 연차 관리(ADJUST)에서.
    let leavePayoutDays: number | null = null;
    if (body.annualLeavePayout && typeof body.annualLeavePayout === "object") {
      const days = Number(body.annualLeavePayout.days);
      if (!Number.isFinite(days) || days <= 0 || days > 30 || Math.round(days * 4) !== days * 4) {
        return NextResponse.json({ success: false, message: "정산 일수는 0.25일 단위, 최대 30일입니다." }, { status: 400 });
      }
      leavePayoutDays = days;
    }

    let gp: number, td: number, breakdown: any;

    if (Array.isArray(body.payLines) || Array.isArray(body.deductLines)) {
      // 그리드 편집 저장
      const payLines = (Array.isArray(body.payLines) ? body.payLines : prevBd.payLines ?? [])
        .map((l: any) => ({ key: s(l.key, 20), name: s(l.name), hours: hrs(l.hours), amount: num(l.amount), method: s(l.method, 120) }));
      const deductLines = (Array.isArray(body.deductLines) ? body.deductLines : prevBd.deductLines ?? [])
        .map((l: any) => ({ key: s(l.key, 20), name: s(l.name), amount: num(l.amount) }));
      const basicInfo = {
        ...(prevBd.basicInfo ?? {}),
        ...(body.basicInfo ?? {}),
        dependents: Math.max(1, Math.min(11, num(body.basicInfo?.dependents ?? prevBd.basicInfo?.dependents ?? 1))),
      };
      gp = payLines.reduce((acc: number, l: any) => acc + l.amount, 0);
      td = deductLines.reduce((acc: number, l: any) => acc + l.amount, 0);
      const deductionBreakdown = Object.fromEntries(deductLines.map((l: any) => [l.name, l.amount]));
      const totalHours = +payLines.reduce((acc: number, l: any) => acc + (l.hours || 0), 0).toFixed(1);
      breakdown = { ...prevBd, payLines, deductLines, basicInfo, deductionBreakdown, totalHours, manualEdited: true };
    } else {
      // 레거시: 총액 직접 수정 (breakdown 보존)
      gp = Number(body.grossPay); td = Number(body.totalDeduction);
      if (isNaN(gp) || isNaN(td)) return NextResponse.json({ success: false, message: "금액 오류" }, { status: 400 });
      breakdown = { ...prevBd, manualTotalEdited: true };
    }

    // 409 사유를 트랜잭션 밖으로 전달하기 위한 센티널(롤백 겸용).
    class PatchConflict extends Error {}
    let updated: Prisma.PayrollItemGetPayload<{ include: { user: { select: { id: true; workerName: true; loginId: true } } } }>;
    try {
      updated = await prisma.$transaction(async (tx) => {
        // ★TOCTOU 차단: run 행 잠금 후 상태 재확인. 위 86행 가드는 fast-path일 뿐 — 그 뒤 확정(POST)이
        //  끼어들면 FINALIZED run 항목이 사후 변경돼 확정본과 불일치했다. FOR UPDATE 행 잠금으로
        //  확정 updateMany와 직렬화한다(확정이 먼저면 여기서 409, 이 저장이 먼저면 확정이 대기 후 진행).
        const cur = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM payroll_runs WHERE id = ${run.id} FOR UPDATE`;
        if (!cur.length || cur[0].status === "FINALIZED") {
          throw new PatchConflict("확정된 급여는 수정할 수 없습니다.");
        }
        if (leavePayoutDays != null) {
          // 워커 advisory 락(연차 승인/직접등록 경로와 동일 키) 획득 후 잔여·중복 재검증 —
          //  락 순서는 run행 → 워커로 고정(연차 라우트는 워커 락만 잡으므로 순서 역전·교착 없음).
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${existingItem.workerId}::bigint)`;
          const dupPayout = await tx.annualLeaveEntry.findFirst({ where: { payrollItemId: itemIdBig, kind: "PAYOUT" }, select: { id: true } });
          if (dupPayout) throw new PatchConflict("이미 이 급여 항목으로 연차를 정산했습니다. 정정은 연차 관리에서 해주세요.");
          const sums = await tx.annualLeaveEntry.aggregate({
            where: { agencyId: run.agencyId, workerId: existingItem.workerId },
            _sum: { days: true },
          });
          const balance = Number(sums._sum.days ?? 0);
          if (balance < leavePayoutDays) throw new PatchConflict(`잔여 연차(${balance}일)가 부족합니다.`);
        }
        const u = await tx.payrollItem.update({
          where: { id: itemIdBig },
          data: {
            grossPay: new Decimal(gp),
            totalDeduction: new Decimal(td),
            netPay: new Decimal(gp - td),
            breakdown,
          },
          include: { user: { select: { id: true, workerName: true, loginId: true } } },
        });
        if (leavePayoutDays != null) {
          const todayKstISO = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          await tx.annualLeaveEntry.create({
            data: {
              agencyId: run.agencyId, workerId: u.workerId, kind: "PAYOUT", days: -leavePayoutDays,
              effectiveDate: new Date(`${todayKstISO}T00:00:00.000Z`),
              sourceLabel: `급여 정산(${run.yearMonth})`,
              createdByManagerId: scope.managerId ?? null,
              payrollItemId: u.id,
            },
          });
        }
        return u;
      });
    } catch (e) {
      if (e instanceof PatchConflict) {
        return NextResponse.json({ success: false, message: e.message }, { status: 409 });
      }
      throw e;
    }

    // 증빙: 급여 항목 수동 편집(연차미사용수당 등 1회성 수당·당월 예외 공제 0 포함)을 감사로그에 기록.
    //  노동청 분쟁 시 지급/공제 조정 이력 증빙. audit 실패가 저장 응답을 깨지 않도록 방어.
    try {
      const earlyLeaveExempt = !!(breakdown?.basicInfo?.earlyLeaveExempt);
      await audit(scope, {
        entityType: "PayrollItem",
        entityId: itemIdBig,
        action: "update",
        summary: `급여 항목 수동 수정 (${run.yearMonth})${earlyLeaveExempt ? " · 당월 예외(조기퇴사): 국민연금·건강·장기요양 공제 0" : ""}${leavePayoutDays != null ? ` · 연차 미사용수당 정산 ${leavePayoutDays}일` : ""}`,
        after: { grossPay: gp, totalDeduction: td, netPay: gp - td, workerId: updated.workerId.toString() },
      });
    } catch (e) { console.error("[payroll item PATCH audit]", e); }

    return NextResponse.json({ success: true, item: itemDto(updated) });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// POST: 확정
export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { runId } = await params;
    const runIdBig = parseBigInt(runId);
    if (!runIdBig) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const run = await prisma.payrollRun.findUnique({ where: { id: runIdBig } });
    if (!run) return NextResponse.json({ success: false, message: "없음" }, { status: 404 });
    if (scope.agencyId && run.agencyId !== scope.agencyId) {
      return NextResponse.json({ success: false, message: "접근 불가" }, { status: 403 });
    }
    if (run.status === "FINALIZED") {
      return NextResponse.json({ success: false, message: "이미 확정되었습니다." }, { status: 409 });
    }

    // ★원자적 전이(C6): 더블탭 동시 확정 시 둘 다 DRAFT를 읽고 위 가드를 통과한 뒤 각각 update+알림+감사를
    //  실행해 명세서 발급 알림·감사로그가 중복 생성되던 것 방지. FINALIZED가 아닐 때만 전이, count=0이면 진 요청.
    const finalizedAt = new Date();
    const upd = await prisma.payrollRun.updateMany({
      where: { id: run.id, status: { not: "FINALIZED" } },
      data: { status: "FINALIZED", finalizedAt },
    });
    if (upd.count === 0) {
      return NextResponse.json({ success: false, message: "이미 확정되었습니다." }, { status: 409 });
    }

    // 전자교부 알림: 대상 직무지도원에게 앱 내 알림(WorkerNotice) 생성. (알림톡·이메일 미사용 — 앱내 무료)
    try {
      const items = await prisma.payrollItem.findMany({ where: { runId: run.id }, select: { workerId: true } });
      if (items.length > 0) {
        await prisma.workerNotice.createMany({
          data: items.map((it) => ({
            workerId: it.workerId,
            agencyId: run.agencyId,
            title: `${run.yearMonth} 급여명세서 발급`,
            body: `${run.yearMonth} 급여명세서가 발급되었습니다. ‘급여명세서’ 메뉴에서 확인·다운로드할 수 있습니다.`,
            type: "INFO",
            kind: "NOTICE_INDIVIDUAL",
            yearMonth: run.yearMonth,
            link: "/worker/payroll",
          })),
        });
      }
    } catch (e) {
      console.error("[payroll finalize notice]", e);
    }

    await audit(scope, { entityType: "PayrollRun", entityId: run.id, action: "update", summary: "급여 확정", after: { status: "FINALIZED", yearMonth: run.yearMonth } });
    return NextResponse.json({
      success: true,
      status: "FINALIZED",
      finalizedAt: finalizedAt.toISOString(),
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
