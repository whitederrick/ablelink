// app/api/admin/system/backup/route.ts
// 시스템 운영자 전용: 전체 데이터 백업(보관 1년 경과분 안전망).
// 고객 화면 export는 보관 1년 제한이지만, 운영자 백업은 전 기간·전 위탁기관(제한 없음).
// GET /api/admin/system/backup?type=attendance|logs&format=xlsx|csv

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import ExcelJS from "exceljs";
// G3: CSV 직렬화는 단일 출처(lib/csv.csvBody) — 로컬 복사본은 헤더 미이스케이프로 인젝션/일관성 drift.
import { csvBody } from "@/lib/csv";

function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtKst(d: Date | null | undefined): string {
  if (!d) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())} ${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}`;
}
async function xlsxBody(sheet: string, header: string[], rows: (string | number)[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => ws.addRow(r));
  ws.columns = header.map(h => ({ width: Math.max(12, Math.min(40, h.length * 2 + 6)) }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);

    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "attendance").trim();
    if (type !== "attendance" && type !== "logs") {
      return NextResponse.json({ success: false, message: "type은 attendance 또는 logs여야 합니다." }, { status: 400 });
    }
    const format = (searchParams.get("format") || "xlsx").trim() === "csv" ? "csv" : "xlsx";
    const stamp = new Date().toISOString().slice(0, 10);

    let header: string[];
    let rows: (string | number)[][];
    let baseName: string;

    if (type === "attendance") {
      const recs = await prisma.dailyAttendance.findMany({
        orderBy: [{ workDate: "asc" }, { id: "asc" }],
        select: {
          workDate: true, startTime: true, endTime: true, status: true,
          isFinalClosed: true, isGpsModified: true, startDistanceM: true,
          user: { select: { workerName: true, phoneNumber: true } },
          site: { select: { companyName: true, agency: { select: { name: true } } } },
        },
      });
      header = ["위탁기관", "날짜", "직무지도원", "연락처", "현장", "출근", "퇴근", "상태", "GPS", "출근거리(m)"];
      rows = recs.map(r => [
        r.site?.agency?.name ?? "",
        r.workDate,
        r.user?.workerName ?? "",
        r.user?.phoneNumber ?? "",
        r.site?.companyName ?? "",
        fmtKst(r.startTime),
        fmtKst(r.endTime),
        r.isFinalClosed ? "종료" : r.startTime ? "근무중" : "출근전",
        r.isGpsModified ? "이탈" : "정상",
        r.startDistanceM != null ? Math.round(Number(r.startDistanceM)) : "",
      ]);
      baseName = `백업_근태_전체_${stamp}`;
    } else {
      const recs = await prisma.traineeLog.findMany({
        orderBy: [{ attendance: { workDate: "asc" } }, { id: "asc" }],
        select: {
          trainingType: true, time1on1: true, timeGroup: true, content: true, evaluation: true,
          attendance: { select: { workDate: true, user: { select: { workerName: true } }, site: { select: { agency: { select: { name: true } } } } } },
          trainee: { select: { name: true } },
          tasks: { select: { taskName: true, performanceScore: true } },
        },
      });
      header = ["위탁기관", "날짜", "직무지도원", "훈련생", "훈련유형", "1:1시간", "그룹시간", "내용", "평가", "작업내용"];
      rows = recs.map(r => [
        r.attendance.site?.agency?.name ?? "",
        r.attendance.workDate,
        r.attendance.user?.workerName ?? "",
        r.trainee?.name ?? "",
        r.trainingType,
        r.time1on1 != null ? String(r.time1on1) : "",
        r.timeGroup != null ? String(r.timeGroup) : "",
        r.content ?? "",
        r.evaluation ?? "",
        r.tasks.map(t => `${t.taskName}(${t.performanceScore}점)`).join("; "),
      ]);
      baseName = `백업_일지_전체_${stamp}`;
    }

    const filename = `${baseName}.${format}`;
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
    if (format === "xlsx") {
      const body = await xlsxBody(type === "attendance" ? "근태" : "일지", header, rows);
      return new NextResponse(body as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": disposition,
        },
      });
    }
    return new NextResponse(csvBody(header, rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/backup]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
