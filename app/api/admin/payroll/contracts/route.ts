// app/api/admin/payroll/contracts/route.ts
// 급여 계약 목록 조회 + 등록

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit } from "@/lib/audit";
import { workerBelongsToAgency } from "@/lib/worker/agencyScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    const where = { agencyId };

    const contracts = await prisma.payContract.findMany({
      where,
      include: {
        user: { select: { id: true, workerName: true, loginId: true } },
      },
      orderBy: [{ workerId: "asc" }, { effectiveFrom: "desc" }],
    });

    return NextResponse.json({
      success: true,
      data: contracts.map(c => ({
        id: c.id.toString(),
        workerId: c.workerId.toString(),
        workerName: c.user.workerName,
        loginId: c.user.loginId,
        agencyId: c.agencyId.toString(),
        workerType: c.workerType,
        payType: c.payType,
        baseAmount: Number(c.baseAmount),
        incomeType: c.incomeType,
        hourlyRate2Plus: c.hourlyRate2Plus != null ? Number(c.hourlyRate2Plus) : null,
        weeklyHolidayPay: c.weeklyHolidayPay != null ? Number(c.weeklyHolidayPay) : null,
        nightRate: c.nightRate != null ? Number(c.nightRate) : null,
        currency: c.currency,
        effectiveFrom: c.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: c.effectiveTo ? c.effectiveTo.toISOString().slice(0, 10) : null,
        createdAt: c.createdAt.toISOString(),
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

    const body = await req.json();
    const { workerId, workerType, payType, baseAmount, effectiveFrom, effectiveTo, incomeType, hourlyRate2Plus, weeklyHolidayPay, nightRate } = body;

    if (!workerId || !payType || !baseAmount || !effectiveFrom) {
      return NextResponse.json({ success: false, message: "필수 항목 누락" }, { status: 400 });
    }
    // ★월중 단가변경 미지원: computeRun은 겹치는 계약 중 최신 1개를 '월 전체'에 적용하므로,
    //  effectiveFrom이 월 중간이면 그 달 전체가 새 단가로 조용히 재계산된다. 분할계산을 지원하기 전까지는
    //  적용 시작일을 매월 1일로 강제해 데이터와 계산 기준을 일치시킨다.
    if (!/^\d{4}-\d{2}-01$/.test(String(effectiveFrom))) {
      return NextResponse.json({ success: false, message: "급여 단가 적용 시작일은 매월 1일이어야 합니다. (월 중간 단가 변경은 아직 지원하지 않습니다)" }, { status: 400 });
    }
    if (!["INTERNAL", "EXTERNAL"].includes(workerType ?? "EXTERNAL")) {
      return NextResponse.json({ success: false, message: "workerType 오류" }, { status: 400 });
    }
    if (!["MONTHLY", "DAILY", "HOURLY"].includes(payType)) {
      return NextResponse.json({ success: false, message: "payType 오류" }, { status: 400 });
    }

    // 정수 문자열만 BigInt 변환(A7: 비정수 입력이 함수레벨 catch로 새 500 나던 것 → 400).
    const parseId = (v: any): bigint | null => {
      const s = String(v ?? "").trim();
      return /^[0-9]+$/.test(s) ? BigInt(s) : null;
    };
    const workerIdVal = parseId(workerId);
    if (workerIdVal == null) {
      return NextResponse.json({ success: false, message: "workerId 오류" }, { status: 400 });
    }
    // ★16차: 이 워커가 본 기관 소속(수락/근무한 배정 또는 계약)인지 검증. 없으면 임의 workerId에 급여계약을 주입해
    //  GET에서 미소속 워커 실명·전화를 수집하는 enabler가 된다(assignments·contracts와 동일 CONSENTED 불변식).
    if (!(await workerBelongsToAgency(workerIdVal, agencyId))) {
      return NextResponse.json({ success: false, message: "이 직무지도원은 본 기관 소속이 아닙니다. 배정 후 급여 기준을 설정해주세요." }, { status: 403 });
    }

    // ★현장별 다시급(siteId override) 제거(2026-07-06, 사용자 확정: 실무 미사용) — 워커당 급여 기준은 하나.
    //  내부직무지도원 규정 강제: 항상 일급 + 사업소득, 2명+시급/주휴수당 없음.
    const resolvedWorkerType: "INTERNAL" | "EXTERNAL" = workerType ?? "EXTERNAL";
    const resolvedPayType     = resolvedWorkerType === "INTERNAL" ? "DAILY" : payType;
    const resolvedIncomeType  = resolvedWorkerType === "INTERNAL" ? "BUSINESS" : (incomeType ?? "BUSINESS");
    // rate2(2명+ 시급)는 스키마상 HOURLY 전용(schema.prisma:1038). write 경계에서 강제 —
    //  非HOURLY에 rate2가 남으면 computeRun이 MONTHLY 월급을 시급값으로 재산정(급여 파탄). (③)
    const resolvedRate2Plus   = resolvedPayType === "HOURLY" ? (hourlyRate2Plus != null ? hourlyRate2Plus : null) : null;
    const resolvedHolidayPay  = resolvedWorkerType === "INTERNAL" ? null : (weeklyHolidayPay != null ? weeklyHolidayPay : null);
    // 야간작업 단가: 프리랜서(EXTERNAL+BUSINESS)에만 유효(수기 참조값). 그 외엔 null(근로소득은 법정 야간가산 자동).
    const resolvedNightRate   = (resolvedWorkerType === "EXTERNAL" && resolvedIncomeType === "BUSINESS" && nightRate != null && nightRate !== "") ? nightRate : null;

    if (resolvedIncomeType && !["BUSINESS", "EMPLOYMENT"].includes(resolvedIncomeType)) {
      return NextResponse.json({ success: false, message: "incomeType 오류" }, { status: 400 });
    }

    // A9: 기존 계약 종료 + 신규 생성을 한 트랜잭션으로 — 폼 이중제출/재시도 시 effectiveTo:null 계약이 둘 생기거나
    //  종료만 되고 생성 실패로 유효계약 0개가 되던 경합 방지.
    const contract = await prisma.$transaction(async (tx) => {
      // 기존 유효 계약(열린) 종료 처리 후 신규 생성.
      if (effectiveTo === undefined || effectiveTo === null) {
        await tx.payContract.updateMany({
          where: { agencyId, workerId: workerIdVal, siteId: null, effectiveTo: null },
          data: { effectiveTo: new Date(effectiveFrom) },
        });
      }
      return tx.payContract.create({
        data: {
          agencyId,
          workerId: workerIdVal,
          siteId: null,
          workerType: resolvedWorkerType,
          payType: resolvedPayType,
          baseAmount,
          currency: "KRW",
          incomeType: resolvedIncomeType,
          hourlyRate2Plus: resolvedRate2Plus,
          weeklyHolidayPay: resolvedHolidayPay,
          nightRate: resolvedNightRate,
          effectiveFrom: new Date(effectiveFrom),
          effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        } as any,
      });
    });

    await audit(scope, { entityType: "PayContract", entityId: contract.id, action: "create", after: { workerId: String(workerId), workerType: resolvedWorkerType, payType: resolvedPayType, baseAmount: Number(baseAmount), incomeType: resolvedIncomeType } });
    return NextResponse.json({ success: true, id: contract.id.toString() });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
