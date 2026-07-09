// app/api/admin/payroll/runs/[runId]/route.ts
// GET: 상세 / PATCH: 항목 수동 수정 / POST: 확정

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { Decimal } from "@prisma/client/runtime/library";
import { audit } from "@/lib/audit";
import type { PayrollBreakdown } from "@/lib/payroll/breakdown";

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
    const run = await prisma.payrollRun.findUnique({
      where: { id: BigInt(runId) },
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
    const run = await prisma.payrollRun.findUnique({ where: { id: BigInt(runId) } });
    if (!run) return NextResponse.json({ success: false, message: "없음" }, { status: 404 });
    if (scope.agencyId && run.agencyId !== scope.agencyId) {
      return NextResponse.json({ success: false, message: "접근 불가" }, { status: 403 });
    }
    if (run.status === "FINALIZED") {
      return NextResponse.json({ success: false, message: "확정된 급여는 수정할 수 없습니다." }, { status: 409 });
    }

    const body = await req.json();
    const itemIdBig = BigInt(body.itemId);

    // IDOR 방지: itemId가 실제 이 run 소속인지 검증 + 기존 breakdown 보존
    const existingItem = await prisma.payrollItem.findUnique({
      where: { id: itemIdBig },
      select: { runId: true, breakdown: true },
    });
    if (!existingItem || existingItem.runId !== run.id) {
      return NextResponse.json({ success: false, message: "접근 불가" }, { status: 403 });
    }
    const prevBd = (existingItem.breakdown ?? {}) as PayrollBreakdown;

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

    const updated = await prisma.payrollItem.update({
      where: { id: itemIdBig },
      data: {
        grossPay: new Decimal(gp),
        totalDeduction: new Decimal(td),
        netPay: new Decimal(gp - td),
        breakdown,
      },
      include: { user: { select: { id: true, workerName: true, loginId: true } } },
    });

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
    const run = await prisma.payrollRun.findUnique({ where: { id: BigInt(runId) } });
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
