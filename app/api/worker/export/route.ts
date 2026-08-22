// app/api/worker/export/route.ts
// 직무지도원 본인 출근부·일지를 엑셀(.xlsx) / CSV로 내보내기 (STARTER+: SHEET_EXPORT)
// GET /api/worker/export?type=attendance|logs&format=xlsx|csv&from=YYYY-MM-DD&to=YYYY-MM-DD
// 보관 1년: from은 1년 전까지로 클램핑.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { checkPlanAccess } from "@/lib/planGuard";
import ExcelJS from "exceljs";
// G3: CSV 직렬화는 단일 출처(lib/csv.csvBody) — 로컬 복사본은 헤더를 이스케이프하지 않아 인젝션/일관성 drift.
import { csvBody } from "@/lib/csv";
import { getKstDateString } from "@/lib/time";

function isDateOnly(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function pad2(n: number) { return String(n).padStart(2, "0"); }

function formatKst(d: Date | null | undefined): string {
  if (!d) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())} ${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}`;
}

async function xlsxBody(sheetName: string, header: string[], rows: (string | number)[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle" };
  rows.forEach(r => ws.addRow(r));
  ws.columns = header.map(h => ({ width: Math.max(12, Math.min(40, h.length * 2 + 6)) }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function fileResponse(filename: string, format: string, csv: string | null, xlsx: Uint8Array | null) {
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
  if (format === "xlsx" && xlsx) {
    // 런타임은 Uint8Array 본문을 그대로 허용; TS 5.7 Uint8Array generic 마찰만 캐스팅으로 우회.
    return new NextResponse(xlsx as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": disposition,
      },
    });
  }
  return new NextResponse(csv ?? "", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disposition,
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const workerId = BigInt(session.workerId);

    // 플랜 게이트 (STARTER+: SHEET_EXPORT)
    const access = await checkPlanAccess(workerId, "SHEET_EXPORT");
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, message: access.message ?? "내보내기는 스타터 플랜 이상에서 사용 가능합니다." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "attendance").trim();
    if (type !== "attendance" && type !== "logs") {
      return NextResponse.json({ success: false, message: "type은 attendance 또는 logs여야 합니다." }, { status: 400 });
    }
    const format = (searchParams.get("format") || "xlsx").trim() === "csv" ? "csv" : "xlsx";

    const fromStr = (searchParams.get("from") || "").trim();
    const toStr   = (searchParams.get("to")   || "").trim();
    if (fromStr && !isDateOnly(fromStr)) return NextResponse.json({ success: false, message: "from 형식 오류" }, { status: 400 });
    if (toStr   && !isDateOnly(toStr))   return NextResponse.json({ success: false, message: "to 형식 오류" }, { status: 400 });

    // ★15차: 날짜 경계는 KST 고정. 서버 UTC getDate로 계산하면 KST 자정~오전9시에 기본 내보내기 시 오늘/이번달
    //  데이터(workDate는 KST 문자열)가 to 경계 밖으로 누락됐다.
    const todayStr = getKstDateString();                 // KST 오늘
    const monthFirst = `${todayStr.slice(0, 7)}-01`;     // KST 이번달 1일
    const [_ey, _em, _ed] = todayStr.split("-").map(Number);
    const earliest = `${_ey - 1}-${pad2(_em)}-${pad2(_ed)}`; // 보관 1년: KST 1년 전

    const from = (fromStr && fromStr > earliest ? fromStr : (fromStr ? earliest : monthFirst));
    const to   = toStr || todayStr;

    if (type === "attendance") {
      const rows = await prisma.dailyAttendance.findMany({
        where: { workerId, workDate: { gte: from, lte: to } },
        orderBy: [{ workDate: "asc" }, { id: "asc" }],
        select: {
          workDate: true, startTime: true, endTime: true, status: true,
          isFinalClosed: true, isGpsModified: true, startDistanceM: true,
          site: { select: { companyName: true } },
        },
      });
      const header = ["날짜", "현장명", "출근시간", "퇴근시간", "상태", "GPS", "출근거리(m)"];
      const data: (string | number)[][] = rows.map(r => [
        r.workDate,
        r.site?.companyName ?? "",
        formatKst(r.startTime),
        formatKst(r.endTime),
        r.isFinalClosed ? "종료" : r.startTime ? "근무중" : "출근전",
        r.isGpsModified ? "이탈" : "정상",
        r.startDistanceM != null ? Math.round(Number(r.startDistanceM)) : "",
      ]);
      const filename = `출근부_${from}_${to}.${format}`;
      return fileResponse(
        filename, format,
        format === "csv" ? csvBody(header, data) : null,
        format === "xlsx" ? await xlsxBody("출근부", header, data) : null
      );
    }

    // type === "logs"
    const logRows = await prisma.traineeLog.findMany({
      where: { attendance: { workerId, workDate: { gte: from, lte: to } } },
      orderBy: [{ attendance: { workDate: "asc" } }, { id: "asc" }],
      select: {
        trainingType: true, time1on1: true, timeGroup: true, content: true, evaluation: true,
        attendance: { select: { workDate: true } },
        trainee: { select: { name: true } },
        tasks: { select: { taskName: true, performanceScore: true } },
      },
    });
    const header = ["날짜", "훈련생", "훈련유형", "1:1시간", "그룹시간", "내용", "평가", "작업내용"];
    const data: (string | number)[][] = logRows.map(r => [
      r.attendance.workDate,
      r.trainee?.name ?? "",
      r.trainingType,
      r.time1on1 != null ? String(r.time1on1) : "",
      r.timeGroup != null ? String(r.timeGroup) : "",
      r.content ?? "",
      r.evaluation ?? "",
      r.tasks.map(t => t.performanceScore != null ? `${t.taskName}(${t.performanceScore}점)` : `${t.taskName}`).join("; "),
    ]);
    const filename = `일지_${from}_${to}.${format}`;
    return fileResponse(
      filename, format,
      format === "csv" ? csvBody(header, data) : null,
      format === "xlsx" ? await xlsxBody("일지", header, data) : null
    );
  } catch (e: any) {
    console.error("[worker/export]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
