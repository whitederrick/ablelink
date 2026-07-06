// app/api/admin/payroll/insurance-rates/route.ts
// 4대보험 요율 조회 + 등록/수정 (ADMIN 전용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);

    const rates = await prisma.insuranceRates.findMany({
      orderBy: { year: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: rates.map(r => ({
        id: r.id.toString(),
        year: r.year,
        nationalPension: Number(r.nationalPension),
        healthInsurance: Number(r.healthInsurance),
        longTermCare: Number(r.longTermCare),
        employmentInsurance: Number(r.employmentInsurance),
        industrialAccident: Number((r as any).industrialAccident ?? 0), // 산재(사업주 부담, 표기용)
        // 국민연금 기준소득월액 하한/상한(원). null=미설정(종전 근사).
        pensionBaseMin: (r as any).pensionBaseMin != null ? Number((r as any).pensionBaseMin) : null,
        pensionBaseMax: (r as any).pensionBaseMax != null ? Number((r as any).pensionBaseMax) : null,
        total: +(
          Number(r.nationalPension) +
          Number(r.healthInsurance) +
          Number(r.longTermCare) +
          Number(r.employmentInsurance)
        ).toFixed(6), // 워커 공제 4대보험 합(산재 제외)
      })),
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 4대보험 요율은 시스템 운영자(Admin) 전용 설정 — 간이세액표와 동일하게 AdminSession으로 제한.
    const session = await requireAdminSession(req);

    const body = await req.json();
    const { year, nationalPension, healthInsurance, longTermCare, employmentInsurance, industrialAccident, pensionBaseMin, pensionBaseMax } = body;

    if (!year || nationalPension == null || healthInsurance == null || longTermCare == null || employmentInsurance == null) {
      return NextResponse.json({ success: false, message: "필수 항목 누락" }, { status: 400 });
    }

    const industrial = industrialAccident == null ? 0 : Number(industrialAccident); // 산재(선택, 기본 0)
    // 국민연금 기준소득월액 하한/상한(원, 선택). 빈값/0이면 null(등급표 미설정 → 종전 근사).
    const pMin = pensionBaseMin != null && Number(pensionBaseMin) > 0 ? Number(pensionBaseMin) : null;
    const pMax = pensionBaseMax != null && Number(pensionBaseMax) > 0 ? Number(pensionBaseMax) : null;
    if (pMin != null && pMax != null && pMin > pMax) {
      return NextResponse.json({ success: false, message: "국민연금 하한액이 상한액보다 클 수 없습니다." }, { status: 400 });
    }
    const rates = await prisma.insuranceRates.upsert({
      where: { year: Number(year) },
      create: {
        year: Number(year),
        nationalPension,
        healthInsurance,
        longTermCare,
        employmentInsurance,
        industrialAccident: industrial,
        pensionBaseMin: pMin,
        pensionBaseMax: pMax,
      } as any,
      update: {
        nationalPension,
        healthInsurance,
        longTermCare,
        employmentInsurance,
        industrialAccident: industrial,
        pensionBaseMin: pMin,
        pensionBaseMax: pMax,
      } as any,
    });

    await audit(session, { entityType: "InsuranceRates", entityId: rates.id, action: "update", after: { year: Number(year), nationalPension: Number(nationalPension), healthInsurance: Number(healthInsurance), longTermCare: Number(longTermCare), employmentInsurance: Number(employmentInsurance), industrialAccident: industrial, pensionBaseMin: pMin, pensionBaseMax: pMax } });
    return NextResponse.json({ success: true, id: rates.id.toString() });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
