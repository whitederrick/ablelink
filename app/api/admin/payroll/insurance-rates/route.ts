// app/api/admin/payroll/insurance-rates/route.ts
// 4대보험 요율 조회 + 등록/수정 (ADMIN 전용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

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
    await requireAdminSession(req);

    const body = await req.json();
    const { year, nationalPension, healthInsurance, longTermCare, employmentInsurance, industrialAccident } = body;

    if (!year || nationalPension == null || healthInsurance == null || longTermCare == null || employmentInsurance == null) {
      return NextResponse.json({ success: false, message: "필수 항목 누락" }, { status: 400 });
    }

    const industrial = industrialAccident == null ? 0 : Number(industrialAccident); // 산재(선택, 기본 0)
    const rates = await prisma.insuranceRates.upsert({
      where: { year: Number(year) },
      create: {
        year: Number(year),
        nationalPension,
        healthInsurance,
        longTermCare,
        employmentInsurance,
        industrialAccident: industrial,
      } as any,
      update: {
        nationalPension,
        healthInsurance,
        longTermCare,
        employmentInsurance,
        industrialAccident: industrial,
      } as any,
    });

    return NextResponse.json({ success: true, id: rates.id.toString() });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
