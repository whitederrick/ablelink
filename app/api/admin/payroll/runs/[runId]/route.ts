// app/api/admin/payroll/runs/[runId]/route.ts
// GET: 상세 / PATCH: 항목 수동 수정 / POST: 확정

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { Decimal } from "@prisma/client/runtime/library";

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

// PATCH: 항목 수동 수정 (grossPay, totalDeduction 재입력)
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

    const { itemId, grossPay, totalDeduction } = await req.json();
    const gp = Number(grossPay);
    const td = Number(totalDeduction);
    if (isNaN(gp) || isNaN(td)) {
      return NextResponse.json({ success: false, message: "금액 오류" }, { status: 400 });
    }

    // IDOR 방지: itemId가 실제 이 run 소속인지 검증
    const itemIdBig = BigInt(itemId);
    const existingItem = await prisma.payrollItem.findUnique({
      where: { id: itemIdBig },
      select: { runId: true },
    });
    if (!existingItem || existingItem.runId !== run.id) {
      return NextResponse.json({ success: false, message: "접근 불가" }, { status: 403 });
    }

    const updated = await prisma.payrollItem.update({
      where: { id: itemIdBig },
      data: {
        grossPay: new Decimal(gp),
        totalDeduction: new Decimal(td),
        netPay: new Decimal(gp - td),
        breakdown: { manual: true, grossPay: gp, totalDeduction: td },
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

    const finalized = await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: "FINALIZED", finalizedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      status: finalized.status,
      finalizedAt: finalized.finalizedAt?.toISOString(),
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
