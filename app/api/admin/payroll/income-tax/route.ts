// app/api/admin/payroll/income-tax/route.ts
// 근로소득 간이세액표 — 운영자가 연도별로 홈택스 표를 붙여넣어 등록. GET 목록 / POST upsert.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { parseHometaxTable } from "@/lib/payroll/incomeTax";

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const rows = await prisma.incomeTaxTable.findMany({ orderBy: { year: "desc" } });
    return NextResponse.json({
      success: true,
      data: rows.map(r => ({ year: r.year, rowCount: r.rowCount, updatedAt: r.updatedAt.toISOString() })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const b = await req.json().catch(() => ({}));
    const year = Number(b?.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ success: false, message: "연도를 확인하세요." }, { status: 400 });
    }
    const brackets = parseHometaxTable(String(b?.text ?? ""));
    if (brackets.length === 0) {
      return NextResponse.json({ success: false, message: "표를 인식하지 못했습니다. 홈택스 표를 엑셀에서 복사(탭 구분)해 붙여넣어 주세요." }, { status: 400 });
    }
    await prisma.incomeTaxTable.upsert({
      where: { year },
      create: { year, data: brackets as any, rowCount: brackets.length },
      update: { data: brackets as any, rowCount: brackets.length },
    });
    return NextResponse.json({ success: true, year, rowCount: brackets.length });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
