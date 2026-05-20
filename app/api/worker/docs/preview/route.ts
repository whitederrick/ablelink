// app/api/worker/docs/preview/route.ts
// 문서 미리보기 API — HTML 반환 (브라우저 렌더링용)
// GET ?docType=...&periodStart=...&periodEnd=...&traineeId=...&format=html|pdf

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

function fmt(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2,"0")}:${String(kst.getUTCMinutes()).padStart(2,"0")}`;
}
function defaultPeriod() {
  const n = new Date();
  const y = n.getFullYear(), m = String(n.getMonth()+1).padStart(2,"0");
  const last = new Date(y, n.getMonth()+1, 0).getDate();
  return { start:`${y}-${m}-01`, end:`${y}-${m}-${String(last).padStart(2,"0")}` };
}
function fmtYMD(s: string) { return s.replace(/-/g,"."); }
function weekDay(s: string) { return ["일","월","화","수","목","금","토"][new Date(s).getDay()]; }

// ── 공통 CSS ─────────────────────────────────────────────
const BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans KR', sans-serif; color: #000; background: #f5f5f5; padding: 20px; }
  .doc-page { background: #fff; width: 210mm; margin: 0 auto; padding: 15mm; box-shadow: 0 2px 12px rgba(0,0,0,0.15); min-height: 297mm; }
  .doc-title { text-align: center; font-size: 18px; font-weight: 900; margin-bottom: 8mm; letter-spacing: 4px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #000; padding: 3px 5px; font-size: 11px; vertical-align: middle; }
  th { font-weight: 700; text-align: center; background: #f8f8f8; }
  .center { text-align: center; }
  .meta-table td { height: 24px; }
  .meta-label { font-weight: 700; background: #f0f0f0; width: 80px; text-align: center; }
  .sig-area { margin-top: 8mm; display: flex; justify-content: flex-end; gap: 20px; font-size: 11px; }
  .sig-box { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .sig-line { width: 60px; height: 40px; border: 1px solid #000; }
  @media print { body { background: #fff; padding: 0; } .doc-page { box-shadow: none; } }
`;

// ── 출근부 HTML ──────────────────────────────────────────
function buildAttendanceHTML(data: any): string {
  const rows = data.rows as any[];
  const tableRows = rows.map(r => `
    <tr>
      <td class="center">${fmtYMD(r.date)}</td>
      <td class="center">${r.date ? weekDay(r.date) : ""}</td>
      <td class="center">${r.startTime ?? "-"}</td>
      <td class="center">${r.endTime ?? "-"}</td>
      <td class="center">${r.startTime && r.endTime ? calcHours(r.startTime, r.endTime) : "-"}</td>
      <td class="center">${r.isFinalClosed ? "✓" : ""}</td>
      <td></td>
    </tr>`).join("");

  const workDays = rows.filter(r => r.startTime).length;
  const totalH = rows.filter(r => r.startTime && r.endTime)
    .reduce((s,r) => s + parseHours(r.startTime, r.endTime), 0);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .main-table td { height: 22px; }
  </style></head><body><div class="doc-page">
    <div class="doc-title">출 근 부</div>
    <table class="meta-table" style="margin-bottom:6mm">
      <tr>
        <td class="meta-label">현장명</td><td>${data.site}</td>
        <td class="meta-label">기간</td><td>${fmtYMD(data.period.start)} ~ ${fmtYMD(data.period.end)}</td>
      </tr>
      <tr>
        <td class="meta-label">출근일수</td><td>${workDays}일</td>
        <td class="meta-label">총 근무시간</td><td>${totalH.toFixed(1)}H</td>
      </tr>
    </table>
    <table class="main-table">
      <thead><tr>
        <th style="width:22mm">날짜</th><th style="width:10mm">요일</th>
        <th style="width:18mm">출근</th><th style="width:18mm">퇴근</th>
        <th style="width:18mm">근무시간</th><th style="width:14mm">확정</th>
        <th>비고</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
      <tfoot><tr>
        <td colspan="4" class="center" style="font-weight:700">합계</td>
        <td class="center" style="font-weight:700">${totalH.toFixed(1)}H</td>
        <td colspan="2"></td>
      </tr></tfoot>
    </table>
    <div class="sig-area">
      <div class="sig-box"><div class="sig-line"></div><div>직무지도원</div></div>
      <div class="sig-box"><div class="sig-line"></div><div>확인자</div></div>
    </div>
  </div></body></html>`;
}

// ── 훈련일지 HTML ────────────────────────────────────────
function buildTrainingLogHTML(data: any): string {
  const rows = data.rows as any[];

  const tableRows = rows.map(r => `
    <tr>
      <td class="center">${fmtYMD(r.date)}<br/>(${weekDay(r.date)})</td>
      <td class="center">${r.traineeName}</td>
      <td class="center">${r.trainingType === "PRE" ? "사전" : "현장"}</td>
      <td class="center">${r.isCompleted ? "출석" : (r.evaluation ?? "-")}</td>
      <td class="center">${r.totalTime}H</td>
      <td class="center">${r.taskScore !== null ? scoreStr(r.taskScore) : "-"}</td>
      <td style="padding:4px 6px; font-size:10px; line-height:1.5">${r.content || "-"}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .main-table td { height: auto; min-height: 28px; }
    .main-table tr td:last-child { min-height: 50px; }
  </style></head><body><div class="doc-page">
    <div class="doc-title">지원고용 훈련일지</div>
    <table class="meta-table" style="margin-bottom:6mm">
      <tr>
        <td class="meta-label">현장명</td><td colspan="3">${data.site}</td>
      </tr>
      <tr>
        <td class="meta-label">기간</td><td>${fmtYMD(data.period.start)} ~ ${fmtYMD(data.period.end)}</td>
        <td class="meta-label">총 인정시간</td><td>${data.summary.totalTime}H</td>
      </tr>
      <tr>
        <td class="meta-label">작성 일지</td><td>${data.summary.totalLogs}건</td>
        <td class="meta-label">완료</td><td>${data.summary.completedLogs}건</td>
      </tr>
    </table>
    <table class="main-table">
      <thead><tr>
        <th style="width:20mm">날짜</th>
        <th style="width:16mm">훈련생</th>
        <th style="width:12mm">구분</th>
        <th style="width:14mm">출결</th>
        <th style="width:16mm">인정시간</th>
        <th style="width:18mm">과제점수</th>
        <th>지도내용</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="sig-area">
      <div class="sig-box"><div class="sig-line"></div><div>직무지도원</div></div>
      <div class="sig-box"><div class="sig-line"></div><div>확인자</div></div>
    </div>
  </div></body></html>`;
}

// ── 종합평가 HTML (훈련생/적응지도 공통) ────────────────
function buildEvalHTML(data: any, title: string): string {
  const rows = data.rows as any[];
  const tableRows = rows.map(r => `
    <tr>
      <td class="center">${r.traineeName}</td>
      <td class="center">${r.traineeGender === "M" ? "남" : "여"}</td>
      <td class="center">${r.logCount}일</td>
      <td class="center">${r.completedCount}일</td>
      <td class="center">${r.totalTime}H</td>
      <td class="center">${r.avgTaskScore !== null ? scoreStr(r.avgTaskScore) : "-"}</td>
      <td class="center" style="font-weight:700;color:${r.completionRate>=80?"#166534":r.completionRate>=50?"#92400e":"#991b1b"}">${r.completionRate}%</td>
      <td style="padding:3px 5px;font-size:10px">${r.evaluations?.join(", ") || "-"}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .main-table td { height: 26px; }
  </style></head><body><div class="doc-page">
    <div class="doc-title">${title}</div>
    <table class="meta-table" style="margin-bottom:6mm">
      <tr>
        <td class="meta-label">현장명</td><td>${data.site}</td>
        <td class="meta-label">기간</td><td>${fmtYMD(data.period.start)} ~ ${fmtYMD(data.period.end)}</td>
      </tr>
      <tr>
        <td class="meta-label">훈련생 수</td><td>${data.summary.traineeCount}명</td>
        <td class="meta-label">총 인정시간</td><td>${data.summary.totalTime}H</td>
      </tr>
    </table>
    <table class="main-table">
      <thead><tr>
        <th style="width:20mm">훈련생명</th>
        <th style="width:12mm">성별</th>
        <th style="width:14mm">지도일수</th>
        <th style="width:14mm">완료일수</th>
        <th style="width:16mm">인정시간</th>
        <th style="width:22mm">평균 과제점수</th>
        <th style="width:14mm">완료율</th>
        <th>수행률 기록</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="sig-area">
      <div class="sig-box"><div class="sig-line"></div><div>직무지도원</div></div>
      <div class="sig-box"><div class="sig-line"></div><div>확인자</div></div>
    </div>
  </div></body></html>`;
}

// ── 적응지도 일지 HTML ───────────────────────────────────
function buildAdaptLogHTML(data: any): string {
  const rows = data.rows as any[];
  const tableRows = rows.map(r => `
    <tr>
      <td class="center">${fmtYMD(r.date)}<br/>(${weekDay(r.date)})</td>
      <td class="center">${r.traineeName}</td>
      <td class="center">${r.totalTime}H</td>
      <td class="center">${r.isCompleted ? "완료" : "임시"}</td>
      <td class="center">${r.taskScore !== null ? scoreStr(r.taskScore) : "-"}</td>
      <td style="padding:4px 6px; font-size:10px; line-height:1.5">${r.content || "-"}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .main-table td { height: auto; min-height: 28px; }
  </style></head><body><div class="doc-page">
    <div class="doc-title">취업 후 적응지도 일지</div>
    <table class="meta-table" style="margin-bottom:6mm">
      <tr>
        <td class="meta-label">현장명</td><td>${data.site}</td>
        <td class="meta-label">기간</td><td>${fmtYMD(data.period.start)} ~ ${fmtYMD(data.period.end)}</td>
      </tr>
      <tr>
        <td class="meta-label">총 일지</td><td>${data.summary.totalLogs}건</td>
        <td class="meta-label">총 인정시간</td><td>${data.summary.totalTime}H</td>
      </tr>
    </table>
    <table class="main-table">
      <thead><tr>
        <th style="width:20mm">날짜</th>
        <th style="width:18mm">훈련생</th>
        <th style="width:16mm">인정시간</th>
        <th style="width:14mm">상태</th>
        <th style="width:18mm">과제점수</th>
        <th>지도내용</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="sig-area">
      <div class="sig-box"><div class="sig-line"></div><div>직무지도원</div></div>
      <div class="sig-box"><div class="sig-line"></div><div>확인자</div></div>
    </div>
  </div></body></html>`;
}

// ── 유틸 ────────────────────────────────────────────────
function calcHours(start: string, end: string): string {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh*60+em) - (sh*60+sm);
  return diff > 0 ? `${(diff/60).toFixed(1)}H` : "-";
}
function parseHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh*60+em) - (sh*60+sm);
  return diff > 0 ? diff/60 : 0;
}
function scoreStr(n: number): string {
  const labels = ["","매우못함","못함","보통","잘함","매우잘함"];
  const idx = Math.round(n);
  return labels[idx] ? `${n}점 (${labels[idx]})` : `${n}점`;
}

// ── 메인 핸들러 ─────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return new Response("Unauthorized", { status: 401 });

    const { searchParams } = new URL(request.url);
    const docType   = searchParams.get("docType") ?? "attendance-sheet";
    const def       = defaultPeriod();
    const startStr  = searchParams.get("periodStart") || def.start;
    const endStr    = searchParams.get("periodEnd")   || def.end;
    const format    = searchParams.get("format") ?? "html"; // html | pdf

    // 조회 API 재사용
    const viewUrl = new URL(`/api/worker/docs/view`, request.url);
    viewUrl.searchParams.set("docType", docType);
    viewUrl.searchParams.set("periodStart", startStr);
    viewUrl.searchParams.set("periodEnd", endStr);

    const viewRes = await fetch(viewUrl.toString(), {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });
    const data = await viewRes.json();

    if (!data.success) {
      return new Response(`<html><body><p style="padding:20px;color:red">${data.message}</p></body></html>`, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // HTML 생성
    let html = "";
    if (docType === "attendance-sheet")    html = buildAttendanceHTML(data);
    else if (docType === "training-daily-log")   html = buildTrainingLogHTML(data);
    else if (docType === "trainee-final-eval")    html = buildEvalHTML(data, "훈련생 종합 평가기록부");
    else if (docType === "adaptation-daily-log")  html = buildAdaptLogHTML(data);
    else if (docType === "adaptation-final-eval") html = buildEvalHTML(data, "적응지도 종합 평가기록부");
    else return new Response("지원하지 않는 문서 유형", { status: 400 });

    // PDF 변환 (Playwright)
    if (format === "pdf") {
      try {
        const { htmlToPdfBuffer } = await import("@/lib/pdf/engine/playwright");
        const pdfBuf = await htmlToPdfBuffer({ html });
        const fileName = encodeURIComponent(`${docType}_${startStr}_${endStr}.pdf`);
        return new Response(pdfBuf, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
          },
        });
      } catch (e: any) {
        return new Response(`PDF 생성 실패: ${e.message}`, { status: 500 });
      }
    }

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  } catch (error: any) {
    console.error("[docs/preview]", error);
    return new Response(`서버 오류: ${error.message}`, { status: 500 });
  }
}
