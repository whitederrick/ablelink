// app/api/admin/payroll/contracts/route.ts
// 급여 계약 목록 조회 + 등록

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    const where = { agencyId };

    const contracts = await prisma.payContract.findMany({
      where,
      include: {
        user: { select: { id: true, workerName: true, loginId: true } },
        site: { select: { id: true, companyName: true } },
      },
      orderBy: [{ workerId: "asc" }, { siteId: "asc" }, { effectiveFrom: "desc" }],
    });

    return NextResponse.json({
      success: true,
      data: contracts.map(c => ({
        id: c.id.toString(),
        workerId: c.workerId.toString(),
        workerName: c.user.workerName,
        loginId: c.user.loginId,
        agencyId: c.agencyId.toString(),
        siteId: (c as any).siteId != null ? (c as any).siteId.toString() : null,
        siteName: (c as any).site?.companyName ?? null,
        workerType: c.workerType,
        payType: c.payType,
        baseAmount: Number(c.baseAmount),
        incomeType: c.incomeType,
        hourlyRate2Plus: c.hourlyRate2Plus != null ? Number(c.hourlyRate2Plus) : null,
        weeklyHolidayPay: c.weeklyHolidayPay != null ? Number(c.weeklyHolidayPay) : null,
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
    const { workerId, workerType, payType, baseAmount, effectiveFrom, effectiveTo, incomeType, hourlyRate2Plus, weeklyHolidayPay, siteId } = body;

    if (!workerId || !payType || !baseAmount || !effectiveFrom) {
      return NextResponse.json({ success: false, message: "필수 항목 누락" }, { status: 400 });
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

    // 같은 기관 다시급: 현장 지정(siteId) = 그 현장 금액 override. 미지정(null) = 기관 기본 계약.
    const hasSite = siteId != null && String(siteId).trim() !== "";
    const siteIdVal = hasSite ? parseId(siteId) : null;
    if (hasSite && siteIdVal == null) {
      return NextResponse.json({ success: false, message: "siteId 오류" }, { status: 400 });
    }
    if (siteIdVal != null) {
      const site = await prisma.site.findUnique({ where: { id: siteIdVal }, select: { agencyId: true } });
      if (!site || site.agencyId !== agencyId) {
        return NextResponse.json({ success: false, message: "현장이 이 기관 소속이 아닙니다." }, { status: 400 });
      }
    }

    // 현장별 계약은 '금액만' override — 급여유형·소득유형·워커유형은 기관 기본 계약에서 상속(일관성 보장).
    //  기본 계약(siteId=null)이 없으면 현장 override를 만들 수 없다(기준 부재).
    let baseForSite: { workerType: "INTERNAL" | "EXTERNAL"; payType: string; incomeType: string } | null = null;
    if (siteIdVal != null) {
      // A1: 기본계약 존재 판정을 computeRun의 계약선택과 일치시킨다 — effectiveTo:null만 요구하면
      //  폼이 종료일(+1년)을 채워 저장하는 정상 기본계약도 '없음'으로 보고 항상 400 나던 버그.
      //  → 현장 override 시작일 기준으로 유효한(겹치는) 기본계약이면 인정.
      const refFrom = new Date(effectiveFrom);
      const baseC = await prisma.payContract.findFirst({
        where: {
          agencyId, workerId: workerIdVal, siteId: null,
          effectiveFrom: { lte: refFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: refFrom } }],
        },
        orderBy: { effectiveFrom: "desc" },
        select: { workerType: true, payType: true, incomeType: true },
      });
      if (!baseC) {
        return NextResponse.json({ success: false, message: "먼저 기관 기본 급여 기준을 등록한 뒤 현장별 금액을 추가하세요." }, { status: 400 });
      }
      // A5: 월급제는 현장과 무관하게 월 급여가 지급 → 현장별 금액 자체가 성립하지 않음(무음 no-op 방지).
      if (baseC.payType === "MONTHLY") {
        return NextResponse.json({ success: false, message: "월급제는 현장과 무관하게 월 급여가 지급되어 현장별 금액을 설정할 수 없습니다." }, { status: 400 });
      }
      // A2: 급여유형은 기본계약과 동일해야 함 — 다르면 무음 교체(과지급 원인) 대신 명시적 400.
      if (payType !== baseC.payType) {
        return NextResponse.json({ success: false, message: `현장별 금액은 기관 기본 계약과 같은 급여유형(${baseC.payType})이어야 합니다.` }, { status: 400 });
      }
      baseForSite = { workerType: baseC.workerType as any, payType: baseC.payType as any, incomeType: baseC.incomeType as any };
    }

    const resolvedWorkerType: "INTERNAL" | "EXTERNAL" = siteIdVal != null ? baseForSite!.workerType : (workerType ?? "EXTERNAL");

    // 내부직무지도원 규정 강제: 항상 일급 + 사업소득, 2명+시급/주휴수당 없음. 현장 계약은 기본에서 상속.
    const resolvedPayType     = siteIdVal != null ? baseForSite!.payType : (resolvedWorkerType === "INTERNAL" ? "DAILY" : payType);
    const resolvedIncomeType  = siteIdVal != null ? baseForSite!.incomeType : (resolvedWorkerType === "INTERNAL" ? "BUSINESS" : (incomeType ?? "BUSINESS"));
    const resolvedRate2Plus   = resolvedWorkerType === "INTERNAL" ? null : (hourlyRate2Plus != null ? hourlyRate2Plus : null);
    const resolvedHolidayPay  = resolvedWorkerType === "INTERNAL" ? null : (weeklyHolidayPay != null ? weeklyHolidayPay : null);

    if (resolvedIncomeType && !["BUSINESS", "EMPLOYMENT"].includes(resolvedIncomeType)) {
      return NextResponse.json({ success: false, message: "incomeType 오류" }, { status: 400 });
    }

    // A9: 기존 계약 종료 + 신규 생성을 한 트랜잭션으로 — 폼 이중제출/재시도 시 effectiveTo:null 계약이 둘 생기거나
    //  종료만 되고 생성 실패로 유효계약 0개가 되던 경합 방지.
    const contract = await prisma.$transaction(async (tx) => {
      // 기존 유효 계약 종료 처리 — 같은 스코프(같은 siteId, null=기관기본)만 종료.
      if (effectiveTo === undefined || effectiveTo === null) {
        await tx.payContract.updateMany({
          where: { agencyId, workerId: workerIdVal, siteId: siteIdVal, effectiveTo: null },
          data: { effectiveTo: new Date(effectiveFrom) },
        });
      }
      return tx.payContract.create({
        data: {
          agencyId,
          workerId: workerIdVal,
          siteId: siteIdVal,
          workerType: resolvedWorkerType,
          payType: resolvedPayType,
          baseAmount,
          currency: "KRW",
          incomeType: resolvedIncomeType,
          hourlyRate2Plus: resolvedRate2Plus,
          weeklyHolidayPay: resolvedHolidayPay,
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
