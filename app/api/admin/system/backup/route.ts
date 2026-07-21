// app/api/admin/system/backup/route.ts
// 시스템 운영자 전용: 전체 데이터 백업(보관 1년 경과분 안전망).
// 고객 화면 export는 보관 1년 제한이지만, 운영자 백업은 전 기간·전 위탁기관(제한 없음).
// GET /api/admin/system/backup?type=attendance|logs&format=xlsx|csv

export const runtime = "nodejs";
// ★2026-07-21 감사 P1(성능): 전 기간·전 기관 무제한 조회 + ExcelJS 인메모리 조립이라 규모 도달 시 기본 함수
//  한도(10s)를 넘겨 확정 실패한다. 함수 실행 상한을 명시하고(아래) 조회에 기간·행수 상한을 강제한다.
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { logAccess } from "@/lib/accessLog";
import { isValidYmd } from "@/lib/time";
import ExcelJS from "exceljs";
// G3: CSV 직렬화는 단일 출처(lib/csv.csvBody) — 로컬 복사본은 헤더 미이스케이프로 인젝션/일관성 drift.
import { csvBody } from "@/lib/csv";

// 백업 1회 최대 행수(안전망). 초과분은 오래된 것부터 잘리며 응답 헤더로 truncated 여부를 알린다.
const MAX_BACKUP_ROWS = 100000;
// 기간 미지정 시 기본 조회 범위(개월). 무제한 대신 최근 N개월로 바운드.
const DEFAULT_MONTHS = 12;

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
    const scope = await requireAdminSession(req);

    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "attendance").trim();
    if (type !== "attendance" && type !== "logs") {
      return NextResponse.json({ success: false, message: "type은 attendance 또는 logs여야 합니다." }, { status: 400 });
    }
    const format = (searchParams.get("format") || "xlsx").trim() === "csv" ? "csv" : "xlsx";
    const stamp = new Date().toISOString().slice(0, 10);

    // 기간 파라미터(yyyy-mm-dd) — 미지정 시 최근 DEFAULT_MONTHS개월로 바운드(무제한 조회 금지).
    const rawFrom = (searchParams.get("from") || "").trim();
    const rawTo = (searchParams.get("to") || "").trim();
    if ((rawFrom && !isValidYmd(rawFrom)) || (rawTo && !isValidYmd(rawTo))) {
      return NextResponse.json({ success: false, message: "from/to는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    }
    const defFrom = (() => { const d = new Date(); d.setMonth(d.getMonth() - DEFAULT_MONTHS); return d.toISOString().slice(0, 10); })();
    const fromYmd = rawFrom || defFrom;
    const toYmd = rawTo || "9999-12-31";
    // workDate는 yyyy-mm-dd 문자열 컬럼이라 사전식 비교로 범위 필터 가능.
    const workDateFilter = { gte: fromYmd, lte: toYmd };

    let header: string[];
    let rows: (string | number)[][];
    let baseName: string;
    let truncated = false;

    if (type === "attendance") {
      const recs = await prisma.dailyAttendance.findMany({
        where: { workDate: workDateFilter },
        orderBy: [{ workDate: "asc" }, { id: "asc" }],
        take: MAX_BACKUP_ROWS + 1,
        select: {
          workDate: true, startTime: true, endTime: true, status: true,
          isFinalClosed: true, isGpsModified: true, startDistanceM: true,
          user: { select: { workerName: true, phoneNumber: true } },
          site: { select: { companyName: true, agency: { select: { name: true } } } },
        },
      });
      if (recs.length > MAX_BACKUP_ROWS) { truncated = true; recs.length = MAX_BACKUP_ROWS; }
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
        where: { attendance: { workDate: workDateFilter } },
        orderBy: [{ attendance: { workDate: "asc" } }, { id: "asc" }],
        take: MAX_BACKUP_ROWS + 1,
        select: {
          trainingType: true, time1on1: true, timeGroup: true, content: true, evaluation: true,
          attendance: { select: { workDate: true, user: { select: { workerName: true } }, site: { select: { agency: { select: { name: true } } } } } },
          trainee: { select: { name: true } },
          tasks: { select: { taskName: true, performanceScore: true } },
        },
      });
      if (recs.length > MAX_BACKUP_ROWS) { truncated = true; recs.length = MAX_BACKUP_ROWS; }
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

    // 접속기록(제8조): 전 기관·전 기간 근태(성명+연락처)·훈련일지 대량 반출 → 반출 1건 집계 기록.
    await logAccess(req, scope, {
      subjectType: type === "attendance" ? "Worker" : "Trainee", subjectId: null,
      subjectLabel: `전체 백업(${type === "attendance" ? "근태" : "일지"}) ${rows.length}건`,
      resource: "worker_detail", action: "export",
    });

    const filename = `${baseName}.${format}`;
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
    // 상한 초과로 잘렸으면 헤더로 알린다(운영자가 기간을 좁혀 재요청하도록).
    const truncHeader: Record<string, string> = truncated ? { "X-Backup-Truncated": `${MAX_BACKUP_ROWS}` } : {};
    if (format === "xlsx") {
      const body = await xlsxBody(type === "attendance" ? "근태" : "일지", header, rows);
      return new NextResponse(body as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": disposition,
          ...truncHeader,
        },
      });
    }
    return new NextResponse(csvBody(header, rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition, ...truncHeader },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/backup]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
