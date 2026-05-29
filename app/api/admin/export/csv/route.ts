// app/api/admin/export/csv/route.ts
// 근태 / 일지 Raw CSV 다운로드
// GET /api/admin/export/csv?type=attendance&from=2026-01-01&to=2026-01-31
// GET /api/admin/export/csv?type=logs&from=2026-01-01&to=2026-01-31
//
// 보관기간 제한: FREE=1개월, STARTER=1년, STANDARD=3년, PRO=무제한

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

function errStatus(msg: string) {
  if (msg === "UNAUTHORIZED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg.startsWith("VALIDATION:")) return 400;
  return 500;
}

function isDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function retentionMonths(plan: string): number | null {
  if (plan === "FREE" || plan === "TRIAL") return 1;
  if (plan === "STARTER") return 12;
  if (plan === "STANDARD") return 36;
  return null; // PRO = 무제한
}

function escapeCsv(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cols: unknown[]): string {
  return cols.map(escapeCsv).join(",");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatKst(iso: Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.getTime() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);

    const type = (searchParams.get("type") || "attendance").trim();
    if (type !== "attendance" && type !== "logs") {
      throw new Error("VALIDATION:type");
    }

    const fromStr = (searchParams.get("from") || "").trim();
    const toStr   = (searchParams.get("to")   || "").trim();

    if (fromStr && !isDateOnly(fromStr)) throw new Error("VALIDATION:from");
    if (toStr   && !isDateOnly(toStr))   throw new Error("VALIDATION:to");

    // 플랜 조회
    const agencyId = scope.agencyId;
    let planType = "FREE";
    if (agencyId) {
      const agency = await prisma.agency.findUnique({
        where: { id: agencyId },
        select: { planType: true },
      });
      planType = agency?.planType ?? "FREE";
    }

    // 보관기간 기반 earliest 날짜 계산
    const months = retentionMonths(planType);
    const today = new Date();
    let earliest: string | null = null;
    if (months !== null) {
      const d = new Date(today);
      d.setMonth(d.getMonth() - months);
      earliest = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    // from/to를 보관기간으로 클램핑
    const effectiveFrom = earliest
      ? (fromStr && fromStr > earliest ? fromStr : earliest)
      : (fromStr || undefined);
    const effectiveTo = toStr || `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

    if (type === "attendance") {
      const where: any = {};
      if (agencyId) where.assignment = { agencyId };
      if (effectiveFrom || effectiveTo) {
        where.workDate = {};
        if (effectiveFrom) where.workDate.gte = effectiveFrom;
        where.workDate.lte = effectiveTo;
      }

      const rows = await prisma.dailyAttendance.findMany({
        where,
        orderBy: [{ workDate: "asc" }, { id: "asc" }],
        select: {
          workDate: true,
          startTime: true,
          endTime: true,
          isFinalClosed: true,
          isGpsModified: true,
          startLocLat: true,
          startLocLon: true,
          endLocLat: true,
          endLocLon: true,
          startDistanceM: true,
          status: true,
          user: { select: { userName: true, phoneNumber: true } },
          site: { select: { companyName: true } },
        },
      });

      const header = "날짜,직무지도원,연락처,현장명,출근시간,퇴근시간,상태,GPS이탈,출근거리(m),출근위도,출근경도";
      const lines = [
        header,
        ...rows.map(r =>
          row([
            r.workDate,
            r.user?.userName ?? "",
            r.user?.phoneNumber ?? "",
            r.site?.companyName ?? "",
            formatKst(r.startTime),
            formatKst(r.endTime),
            r.isFinalClosed ? "종료" : r.startTime ? "근무중" : "출근전",
            r.isGpsModified ? "이탈" : "정상",
            r.startDistanceM != null ? Math.round(Number(r.startDistanceM)) : "",
            r.startLocLat != null ? String(r.startLocLat) : "",
            r.startLocLon != null ? String(r.startLocLon) : "",
          ])
        ),
      ];

      const filename = `근태_${effectiveFrom ?? "all"}_${effectiveTo}.csv`;
      return new NextResponse("﻿" + lines.join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    }

    // type === "logs"
    const where: any = {};
    if (agencyId) {
      where.attendance = { assignment: { agencyId } };
    }
    if (effectiveFrom || effectiveTo) {
      where.attendance = {
        ...(where.attendance ?? {}),
        workDate: {
          ...(effectiveFrom ? { gte: effectiveFrom } : {}),
          lte: effectiveTo,
        },
      };
    }

    const logRows = await prisma.traineeLog.findMany({
      where,
      orderBy: [{ attendance: { workDate: "asc" } }, { id: "asc" }],
      select: {
        trainingType: true,
        time1on1: true,
        timeGroup: true,
        content: true,
        evaluation: true,
        attendance: {
          select: {
            workDate: true,
            user: { select: { userName: true, phoneNumber: true } },
          },
        },
        trainee: {
          select: { name: true },
        },
        tasks: { select: { taskName: true, performanceScore: true, difficulty: true } },
      },
    });

    const header = "날짜,직무지도원,연락처,훈련생,훈련유형,1:1시간,그룹시간,내용,평가,작업내용";
    const lines = [
      header,
      ...logRows.map(r => {
        const taskStr = r.tasks.map(t => `${t.taskName}(${t.performanceScore}점)`).join("; ");
        return row([
          r.attendance.workDate,
          r.attendance.user?.userName ?? "",
          r.attendance.user?.phoneNumber ?? "",
          r.trainee?.name ?? "",
          r.trainingType,
          r.time1on1 != null ? String(r.time1on1) : "",
          r.timeGroup != null ? String(r.timeGroup) : "",
          r.content ?? "",
          r.evaluation ?? "",
          taskStr,
        ]);
      }),
    ];

    const filename = `일지_${effectiveFrom ?? "all"}_${effectiveTo}.csv`;
    return new NextResponse("﻿" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    const msg = e?.message || "UNKNOWN";
    return NextResponse.json({ success: false, message: msg }, { status: errStatus(msg) });
  }
}
