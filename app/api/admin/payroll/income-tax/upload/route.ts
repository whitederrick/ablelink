// app/api/admin/payroll/income-tax/upload/route.ts
// 근로소득 간이세액표 엑셀(.xlsx) 업로드 → 셀 직접 파싱(콤마/탭 문제 없음). 운영자 전용.
// multipart/form-data: file=<xlsx>, year=<number>

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { bracketsFromMatrix } from "@/lib/payroll/incomeTax";
import ExcelJS from "exceljs";

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const form = await req.formData();
    const year = Number(form.get("year"));
    const file = form.get("file");
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ success: false, message: "연도를 확인하세요." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, message: "엑셀 파일을 첨부하세요." }, { status: 400 });
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx")) {
      return NextResponse.json({ success: false, message: ".xlsx 파일만 지원합니다. 엑셀에서 '다른 이름으로 저장 → .xlsx'로 변환해 업로드하세요." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    if (!ws) return NextResponse.json({ success: false, message: "시트를 찾을 수 없습니다." }, { status: 400 });

    // 모든 행을 셀 값 행렬로 환원 (row.values는 1-base, 0 인덱스는 null)
    const rows: any[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(vals.map((v: any) => {
        if (v == null) return null;
        if (typeof v === "object") return v.result ?? v.text ?? v.value ?? null; // 수식/리치텍스트 셀
        return v;
      }));
    });

    const brackets = bracketsFromMatrix(rows);
    if (brackets.length === 0) {
      return NextResponse.json({ success: false, message: "표 데이터를 인식하지 못했습니다. 간이세액표 시트인지 확인하세요." }, { status: 400 });
    }

    await prisma.incomeTaxTable.upsert({
      where: { year },
      create: { year, data: brackets as any, rowCount: brackets.length },
      update: { data: brackets as any, rowCount: brackets.length },
    });
    return NextResponse.json({ success: true, year, rowCount: brackets.length });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[income-tax/upload]", e);
    return NextResponse.json({ success: false, message: "업로드 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
