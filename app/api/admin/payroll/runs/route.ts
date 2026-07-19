// app/api/admin/payroll/runs/route.ts
// GET: 급여 실행 목록 / POST: 월별 급여 계산(DRAFT 생성)
// 계산 로직은 lib/payroll/computeRun.ts(computePayrollItems)로 추출 — 매월 자동 크론과 공유.

export const runtime = "nodejs";
// PERF-6: 급여 계산은 동기 처리라 기관 규모↑ 시 타임아웃 위험. 상한을 300초로 늘려 크래시를 막고
//  (300초는 기대치가 아니라 안전 천장), 60초 초과 시 운영자 콘솔(감사)에 하루 1회 알림 → 큐 전환 신호.
export const maxDuration = 300;

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { computePayrollItems } from "@/lib/payroll/computeRun";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    const where = { agencyId };
    const runs = await prisma.payrollRun.findMany({
      where,
      include: { items: { select: { id: true } } },
      orderBy: { yearMonth: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: runs.map(r => ({
        id: r.id.toString(),
        yearMonth: r.yearMonth,
        status: r.status,
        itemCount: r.items.length,
        createdAt: r.createdAt.toISOString(),
        finalizedAt: r.finalizedAt?.toISOString() ?? null,
      })),
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "위탁기관 정보 없음" }, { status: 403 });
    }

    const planCheck = await checkAgencyPlanAccess(agencyId, "PAYROLL");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
    }

    const { yearMonth } = await req.json();
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });
    }

    // 기존 DRAFT 있으면 삭제 후 재계산 (트랜잭션으로 원자적 처리)
    const existing = await prisma.payrollRun.findUnique({ where: { agencyId_yearMonth: { agencyId, yearMonth } } });
    if (existing?.status === "FINALIZED") {
      return NextResponse.json({ success: false, message: "이미 확정된 급여입니다. 수정할 수 없습니다." }, { status: 409 });
    }

    // 급여 계산(소득유형·4대보험 자동 판정 포함) — 크론과 동일 로직.
    const _t0 = Date.now();
    const { items, userCount } = await computePayrollItems(agencyId, yearMonth);
    const _durMs = Date.now() - _t0;
    // PERF-6 관찰: 20초↑ 로그. 60초↑(타임아웃 근접 = 큐 전환 신호)면 운영자 콘솔(감사)에 하루 1회 알림.
    if (_durMs > 20000) {
      console.warn(`[payroll/runs] 급여계산 지연 — agency=${agencyId} ym=${yearMonth} users=${userCount} ${_durMs}ms`);
    }
    if (_durMs > 60000) {
      const throttle = await checkRateLimit(`payroll-slow-alert:${agencyId}`, { max: 1, windowSec: 86400, blockSec: 86400 });
      if (throttle.allowed) {
        await audit(null, {
          entityType: "PayrollPerf",
          entityId: agencyId,
          action: "alert",
          summary: `급여 계산이 ${Math.round(_durMs / 1000)}초 소요(${userCount}명·${yearMonth}) — 타임아웃 임박. 급여 계산 큐/작업테이블 전환 검토 필요.`,
        });
      }
    }
    if (userCount === 0) {
      return NextResponse.json({ success: false, message: "해당 월에 활성 직무지도원이 없습니다." }, { status: 400 });
    }

    const run = await prisma.$transaction(async (tx) => {
      // 확인(위 findUnique)과 삭제 사이에 다른 요청이 확정할 수 있으므로 트랜잭션 안에서 상태 재확인 후 삭제.
      //  (재확인 없이 id로만 삭제하면 그 사이 FINALIZED된 run을 지우고 DRAFT로 덮어쓰는 경합이 생김.)
      const cur = await tx.payrollRun.findUnique({
        where: { agencyId_yearMonth: { agencyId, yearMonth } },
        select: { id: true, status: true },
      });
      if (cur?.status === "FINALIZED") {
        throw NextResponse.json({ success: false, message: "이미 확정된 급여입니다. 수정할 수 없습니다." }, { status: 409 });
      }
      if (cur) {
        // 항목 편집(PATCH: run 행 FOR UPDATE)과 직렬화 — 잠금 없이 진행하면 PATCH가 방금 만든 PAYOUT을
        //  아래 스냅샷이 못 보고 run 삭제로 고아를 다시 만들 수 있다. 같은 행 잠금을 먼저 획득한다.
        await tx.$executeRaw`SELECT id FROM payroll_runs WHERE id = ${cur.id} FOR UPDATE`;
        // ★PAYOUT 고아 방지: 이 DRAFT의 급여 항목에 연결된 연차 미사용수당 정산(PAYOUT)은 항목 삭제와 함께
        //  지급 근거(수당 라인)를 잃는다. 그대로 두면 원장 −일수만 남고, 재정산 시 payrollItemId가 새 항목 id라
        //  중복검사도 못 잡아 이중차감된다. 원장은 append-only(삭제 금지 규율) → 반대 부호 ADJUST로 취소를
        //  기록해 잔여를 복원한다(정산이 필요하면 새 DRAFT에서 다시 등록).
        const runItems = await tx.payrollItem.findMany({ where: { runId: cur.id }, select: { id: true } });
        if (runItems.length > 0) {
          const payouts = await tx.annualLeaveEntry.findMany({
            where: { kind: "PAYOUT", payrollItemId: { in: runItems.map((i) => i.id) } },
            select: { id: true, workerId: true, days: true, effectiveDate: true, payrollItemId: true },
          });
          if (payouts.length > 0) {
            await tx.annualLeaveEntry.createMany({
              data: payouts.map((p) => ({
                agencyId,
                workerId: p.workerId,
                kind: "ADJUST" as const,
                days: p.days.neg(), // PAYOUT은 음수 → 반대 부호(+)로 잔여 복원
                effectiveDate: p.effectiveDate,
                sourceLabel: `정산 취소(급여 재계산 ${yearMonth})`,
                memo: `급여 재계산으로 초안이 삭제되어 연차 미사용수당 정산을 자동 취소했습니다. 필요 시 새 초안에서 다시 정산해 주세요.`,
                createdByManagerId: scope.managerId ?? null,
                payrollItemId: p.payrollItemId, // 취소 대상 추적용(삭제된 항목 id)
              })),
            });
          }
        }
        // 조건부 삭제 — 재확인(위)과 삭제 사이에 다른 요청이 FINALIZED로 만들면 0건 삭제→409(확정 급여 보호).
        const del = await tx.payrollRun.deleteMany({ where: { id: cur.id, status: { not: "FINALIZED" } } });
        if (del.count === 0) {
          throw NextResponse.json({ success: false, message: "이미 확정된 급여입니다. 수정할 수 없습니다." }, { status: 409 });
        }
      }
      return tx.payrollRun.create({
        data: { agencyId, yearMonth, status: "DRAFT", items: { create: items } },
        include: { items: { include: { user: { select: { id: true, workerName: true } } } } },
      });
    });

    await audit(scope, { entityType: "PayrollRun", entityId: run.id, action: "create", after: { yearMonth, status: "DRAFT", itemCount: run.items.length } });
    return NextResponse.json({
      success: true,
      id: run.id.toString(),
      yearMonth: run.yearMonth,
      itemCount: run.items.length,
      items: run.items.map(i => ({
        id: i.id.toString(),
        workerId: i.workerId.toString(),
        workerName: i.user.workerName,
        grossPay: Number(i.grossPay),
        totalDeduction: Number(i.totalDeduction),
        netPay: Number(i.netPay),
        workedDays: i.workedDays,
        workedMinutes: i.workedMinutes,
        breakdown: i.breakdown,
      })),
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
