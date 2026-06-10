// app/api/admin/payroll/income-tax/bonus/route.ts
// 상여 원천징수세액 계산(지급대상기간 원칙). 그리드 상여 입력에서 호출. 매니저 사용.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { computeBonusTax, type TaxBracket } from "@/lib/payroll/incomeTax";

export async function GET(req: NextRequest) {
  try {
    await requireManagerSession(req);
    const sp = new URL(req.url).searchParams;
    const num = (k: string) => Number(sp.get(k));
    const bonus = num("bonus");
    const monthlyPay = num("monthlyPay");
    const months = Math.max(1, Math.min(12, num("months") || 1));
    const dependents = Math.max(1, Math.min(11, num("dependents") || 1));
    const childUnder20 = Math.max(0, num("childUnder20") || 0);
    const rate = num("rate") || 100;
    const year = num("year") || new Date().getFullYear();
    const alreadyWithheld = sp.get("alreadyWithheld") != null ? num("alreadyWithheld") : undefined;
    if (!Number.isFinite(bonus)) return NextResponse.json({ success: false, message: "bonus 필요" }, { status: 400 });

    const row = await prisma.incomeTaxTable.findFirst({ where: { year: { lte: year } }, orderBy: { year: "desc" } });
    if (!row) return NextResponse.json({ success: true, hasTable: false });

    const brackets: TaxBracket[] = Array.isArray(row.data) ? (row.data as any) : [];
    const r = computeBonusTax(brackets, { bonus, monthlyPay, months, dependents, childUnder20, rate, alreadyWithheld });
    return NextResponse.json({ success: true, hasTable: true, year: row.year, ...r });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
