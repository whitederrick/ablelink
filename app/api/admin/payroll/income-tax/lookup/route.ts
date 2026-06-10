// app/api/admin/payroll/income-tax/lookup/route.ts
// 과세급여·부양가족수로 소득세 조회(그리드에서 부양가족수 변경 시 재조회). 주민세=소득세 10%.
// 매니저도 사용 — requireManagerSession.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { lookupIncomeTax, localIncomeTax, type TaxBracket } from "@/lib/payroll/incomeTax";

export async function GET(req: NextRequest) {
  try {
    await requireManagerSession(req);
    const sp = new URL(req.url).searchParams;
    const pay = Number(sp.get("pay"));
    const dependents = Math.max(1, Math.min(11, Number(sp.get("dependents")) || 1));
    const year = Number(sp.get("year")) || new Date().getFullYear();
    if (!Number.isFinite(pay)) return NextResponse.json({ success: false, message: "pay 필요" }, { status: 400 });

    const row = await prisma.incomeTaxTable.findFirst({ where: { year: { lte: year } }, orderBy: { year: "desc" } });
    if (!row) return NextResponse.json({ success: true, hasTable: false, incomeTax: null, localTax: null });

    const brackets: TaxBracket[] = Array.isArray(row.data) ? (row.data as any) : [];
    const incomeTax = lookupIncomeTax(brackets, pay, dependents) ?? 0;
    return NextResponse.json({ success: true, hasTable: true, year: row.year, incomeTax, localTax: localIncomeTax(incomeTax) });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
