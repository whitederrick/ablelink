// lib/pdf/templates-html/ATTENDANCE_SHEET.ts
// 직무지도원 출근부 — jsreport 원본 1:1 이식
import { buildHcrFontFaceCss } from "../engine/fontEmbed";

export type AttendanceSheetEntry = {
  date: string;      // "M/D" 표시용
  start?: string;
  end?: string;
  hours?: string | number;
  multiHours?: string | number;
};

export type AttendanceSheetWeek = {
  days: {
    mon: AttendanceSheetEntry | { date: null };
    tue: AttendanceSheetEntry | { date: null };
    wed: AttendanceSheetEntry | { date: null };
    thu: AttendanceSheetEntry | { date: null };
    fri: AttendanceSheetEntry | { date: null };
    sat: AttendanceSheetEntry | { date: null };
    sun: AttendanceSheetEntry | { date: null };
  };
};

export type AttendanceSheetPayload = {
  workerName: string;
  workerPhone: string;
  companyName: string;
  periodStartYMD: string;
  periodEndYMD: string;
  totalDays: number | string;
  totalHours: number | string;
  weeklyHolidayCount: number | string;
  monthlyLeaveCount: number | string;
  allowanceTotalWon: string;
  oneToOneHours: number | string;
  oneToManyHours: number | string;
  otOneToOneHours: number | string;
  otOneToManyHours: number | string;
  // beforeRender가 생성
  year?: number; month?: number; day?: number;
  weeks?: AttendanceSheetWeek[];
  signatureNewPage?: boolean;
  signatureTopMarginMm?: number;
  signatures?: {
    govAgent?:      { name?: string; imageUrl?: string };
    companyManager?: { name?: string; imageUrl?: string };
    worker?:          { name?: string; imageUrl?: string };
  };
  // raw entries (beforeRender 입력용)
  entries?: Array<{
    date?: string; workDate?: string; day?: string;
    start?: string; startTime?: string;
    end?: string; endTime?: string;
    hours?: string | number; totalHours?: string | number;
    multiHours?: string | number; oneToManyHours?: string | number;
  }>;
};

// ── beforeRender 로직 (주차 생성, 서명 위치 계산) ─────────────────
function toKstDateOnly(d: Date | string): string {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(typeof d === "string" ? d : d.getTime());
  const kst = new Date(dt.getTime() + 9 * 3600000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
}

function dayOfWeekMon0(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (js + 6) % 7;
}

function ymdToMD(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function buildWeeks(periodStart: string, periodEnd: string, entries: AttendanceSheetPayload["entries"]): AttendanceSheetWeek[] {
  const start = toKstDateOnly(periodStart);
  const end   = toKstDateOnly(periodEnd);
  const map = new Map<string, AttendanceSheetEntry>();
  for (const raw of (entries ?? [])) {
    const date = toKstDateOnly((raw.date ?? raw.workDate ?? raw.day ?? "") as string);
    map.set(date, {
      date: ymdToMD(date),
      start: raw.start ?? raw.startTime ?? "",
      end:   raw.end   ?? raw.endTime   ?? "",
      hours: raw.hours ?? raw.totalHours ?? "",
      multiHours: raw.multiHours ?? raw.oneToManyHours ?? "",
    });
  }
  const startDow = dayOfWeekMon0(start);
  let cursorMon = addDays(start, -startDow);
  const weeks: AttendanceSheetWeek[] = [];
  const keys = ["mon","tue","wed","thu","fri","sat","sun"] as const;
  while (cursorMon <= end) {
    const days = {} as AttendanceSheetWeek["days"];
    for (let i = 0; i < 7; i++) {
      const ymd = addDays(cursorMon, i);
      const k = keys[i];
      if (ymd < start || ymd > end) { (days as any)[k] = { date: null }; continue; }
      const hit = map.get(ymd);
      (days as any)[k] = hit ?? { date: ymdToMD(ymd), start:"", end:"", hours:"", multiHours:"" };
    }
    weeks.push({ days });
    cursorMon = addDays(cursorMon, 7);
  }
  return weeks;
}

function preparePayload(p: AttendanceSheetPayload): Required<AttendanceSheetPayload> {
  const today = toKstDateOnly(new Date());
  const [yy, mm, dd] = today.split("-");
  const weeks = buildWeeks(p.periodStartYMD, p.periodEndYMD, p.entries ?? []);

  const PAGE_H = 257;
  const TOP_FIXED_H = 18 + 44 + 6 + 7;
  const WORK_HEAD_H = 5;
  const WEEK_BLOCK_H = 23;
  const CONFIRM_H = 18;
  const SIGN_H = 24;
  const usedBeforeSign = TOP_FIXED_H + WORK_HEAD_H + (weeks.length * WEEK_BLOCK_H) + CONFIRM_H;
  const freeLast = PAGE_H - usedBeforeSign;
  const marginTop = freeLast - SIGN_H;

  return {
    ...p,
    year: Number(yy), month: Number(mm), day: Number(dd),
    weeks,
    signatureNewPage: marginTop < 0,
    signatureTopMarginMm: Math.max(0, marginTop),
    signatures: p.signatures ?? {},
    entries: p.entries ?? [],
  } as any;
}

// ── 셀 렌더 헬퍼 ────────────────────────────────────────────────
type DayCell = AttendanceSheetEntry | { date: null };

function dayDate(d: DayCell): string {
  return d.date == null ? "/" : (d.date || "/");
}
function dayVal(d: DayCell, key: "start"|"end"|"hours"|"multiHours"): string {
  if (d.date == null) return "";
  return String((d as any)[key] ?? "");
}
function timeCell(d: DayCell): string {
  const s = dayVal(d,"start") || ":";
  const e = dayVal(d,"end")   || ":";
  const h = dayVal(d,"hours");
  return `<div class="timeCell">
    <span class="l1">${s}</span>
    <span class="l2">~ ${e}</span>
    <span class="l3">${h ? `(${h}h)` : "(h)"}</span>
  </div>`;
}
function multiCell(d: DayCell): string {
  const v = dayVal(d,"multiHours");
  return v ? `(${v}h)` : "(h)";
}
function sigRow(label: string, name: string, imgUrl?: string): string {
  const img = imgUrl ? `<img class="sign-img" src="${imgUrl}" />` : "";
  return `<div class="sign-row">
    <span class="sign-label">${label}</span>
    <span class="sign-colon">:</span>
    <span class="sign-slot">${name}</span>
    <span class="sign-text">(서명 또는 인)${img}</span>
  </div>`;
}

export function renderATTENDANCE_SHEET_HTML(raw: AttendanceSheetPayload): string {
  const p = preparePayload(raw);
  const fontCss = buildHcrFontFaceCss("20mm 30mm 15mm 30mm");
  const sigs = p.signatures ?? {};

  const weeksHtml = (p.weeks ?? []).map(w => {
    const ks = ["mon","tue","wed","thu","fri","sat","sun"] as const;
    const ds = ks.map(k => (w.days as any)[k] as DayCell);
    return `
    <tr class="row-date blockTop">
      <th>일자</th>
      ${ds.map(d => `<td>${dayDate(d)}</td>`).join("")}
    </tr>
    <tr class="row-total">
      <th class="leftStack"><span class="a">총</span><span class="b">지도시간</span></th>
      ${ds.map(d => `<td>${timeCell(d)}</td>`).join("")}
    </tr>
    <tr class="row-multi">
      <th>1:多 지도</th>
      ${ds.map(d => `<td>${multiCell(d)}</td>`).join("")}
    </tr>`;
  }).join("\n");

  const signBreak = p.signatureNewPage ? "sign-break" : "";
  const marginTop = p.signatureNewPage ? 0 : (p.signatureTopMarginMm ?? 0);

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<style>
${fontCss}

body {
  font-family:"HCRDotum","Dotum","돋움","Malgun Gothic",sans-serif;
  font-size:10.5pt; color:#000;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.sheet { width:170mm; margin:0 auto; min-height:257mm; display:flex; flex-direction:column; }

.title {
  font-family:"HCRBatang","Batang","바탕",serif;
  font-weight:700; text-align:center; font-size:19pt;
  line-height:1.35; margin:0 0 3pt 0;
}
table { width:100%; border-collapse:collapse; table-layout:fixed; }
.tbox { border:1.2pt solid #000; }
th, td { border:0.6pt solid #000; padding:0.6mm 1.5mm; letter-spacing:-0.8px; vertical-align:middle; }
.label { font-weight:400; text-align:center; letter-spacing:-0.8px; }
.value { text-align:center; white-space:normal; word-break:keep-all; }
.small { font-size:10.0pt; }
.note { margin:0.6mm 0 2mm 0; font-size:11pt; line-height:1.60; letter-spacing:-0.10em;
  transform:scaleX(0.95); transform-origin:left center; font-family:"HCRDotum",sans-serif; }
.sectionTitle { font-family:"HCRBatang",serif; margin:2mm 0 3pt 0;
  font-weight:400; font-size:12pt; line-height:1.35; }

.work { font-size:11pt; font-family:"HCRDotum",sans-serif; line-height:1.60; }
.work th, .work td { text-align:center; padding:0.1mm 0.9mm; line-height:1.45; vertical-align:middle; }
.work col.col-left { width:22mm; }
.work col.col-day  { width:calc((100% - 22mm) / 7); }
.work .head th     { font-weight:700; height:5mm; }
.work .row-date th, .work .row-date td { height:5mm; }
.work .row-total th, .work .row-total td { height:12mm; padding-top:0; padding-bottom:0; }
.work .row-multi th, .work .row-multi td { height:5mm; }
.work .blockTop th, .work .blockTop td { border-top:1.2pt solid #000; }
.leftStack { line-height:1.1; }
.leftStack .a, .leftStack .b { display:block; }
.timeCell { height:100%; display:flex; flex-direction:column; justify-content:center; line-height:1.18; }
.timeCell .l1, .timeCell .l2, .timeCell .l3 { display:block; }
.timeCell .l3 { text-align:right; padding-right:1mm; }

.confirmCenter { text-align:center; margin-top:11pt; font-size:11pt; line-height:1.35;
  letter-spacing:-0.05em; transform:scaleX(0.95); transform-origin:center; font-family:"HCRDotum",sans-serif; }
.dateCenter { text-align:center; margin-top:0; font-size:11pt; line-height:1.35;
  letter-spacing:-0.05em; transform:scaleX(0.95); transform-origin:center; font-family:"HCRDotum",sans-serif; }

.sign-break { page-break-before:always; break-before:page; }
.sign-area { width:100%; break-inside:avoid; page-break-inside:avoid; margin-top:${marginTop}mm; }
.sign-lines { width:100%; font-family:"HCRDotum",sans-serif; font-size:12pt; line-height:1.35;
  letter-spacing:-0.05em; transform:scaleX(0.95); transform-origin:right center; }
.sign-row { display:grid; grid-template-columns:95mm 6mm 1fr auto;
  align-items:center; height:8mm; white-space:nowrap; }
.sign-label { text-align:right; padding-right:1mm; }
.sign-colon { text-align:center; }
.sign-slot  { white-space:nowrap; display:inline-flex; align-items:center; position:relative; }
.sign-text  { position:relative; display:inline-block; white-space:nowrap;
  min-width:28mm; text-align:center; z-index:0; }
.sign-img   { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  width:28mm; height:20mm; object-fit:contain; opacity:0.6; pointer-events:none; z-index:1; }
</style>
</head>
<body>
<div class="sheet">
  <div class="title">직무지도원 출근부</div>

  <table class="tbox">
    <colgroup>
      <col style="width:35mm"/><col style="width:50mm"/>
      <col style="width:35mm"/><col style="width:50mm"/>
    </colgroup>
    <tr>
      <th class="label">성&nbsp;&nbsp;&nbsp;&nbsp;명</th>
      <td class="value">${p.workerName}</td>
      <th class="label">연락처</th>
      <td class="value">${p.workerPhone}</td>
    </tr>
    <tr>
      <th class="label">배치사업체명</th>
      <td class="value">${p.companyName}</td>
      <th class="label">지도기간</th>
      <td class="value">${p.periodStartYMD}<br/>~ ${p.periodEndYMD}</td>
    </tr>
    <tr>
      <th class="label">지도일수 및 시간<br><span class="small">(주휴미포함)</span></th>
      <td class="value">총&nbsp;${p.totalDays}&nbsp;일,&nbsp;총&nbsp;${p.totalHours}&nbsp;h</td>
      <th class="label">주휴수당 등</th>
      <td class="value">주휴&nbsp;${p.weeklyHolidayCount}&nbsp;회&nbsp;&nbsp;월차&nbsp;${p.monthlyLeaveCount}&nbsp;회<br/>총&nbsp;${p.allowanceTotalWon}&nbsp;원</td>
    </tr>
    <tr>
      <th class="label">일반&nbsp;지도시간<br><span class="small">(1:1 지도시간)</span></th>
      <td class="value">총&nbsp;${p.oneToOneHours}&nbsp;h</td>
      <th class="label">1:多 지도시간<br><span class="small">(2인 이상)</span></th>
      <td class="value">총&nbsp;${p.oneToManyHours}&nbsp;h</td>
    </tr>
    <tr>
      <th class="label">연장&nbsp;지도시간<br><span class="small">(1:1 지도시간)</span></th>
      <td class="value">총&nbsp;${p.otOneToOneHours}&nbsp;h</td>
      <th class="label">연장 1:多 지도 시간<br><span class="small">(2인 이상)</span></th>
      <td class="value">총&nbsp;${p.otOneToManyHours}&nbsp;h</td>
    </tr>
  </table>

  <div class="note">※ 주휴수당은 위탁기관 담당자가 작성</div>
  <div class="sectionTitle">&nbsp;&nbsp;■&nbsp;근무상황표</div>

  <table class="tbox work">
    <colgroup>
      <col class="col-left"/>
      <col class="col-day"/><col class="col-day"/><col class="col-day"/>
      <col class="col-day"/><col class="col-day"/><col class="col-day"/><col class="col-day"/>
    </colgroup>
    <tr class="head">
      <th>구분</th>
      <th>월</th><th>화</th><th>수</th><th>목</th><th>금</th><th>토</th><th>일</th>
    </tr>
    ${weeksHtml}
  </table>

  <div class="confirmCenter">위와 같이 근무(출근) 하였음을 확인함</div>
  <div class="dateCenter">${p.year}년&nbsp;&nbsp;&nbsp;&nbsp;${p.month}월&nbsp;&nbsp;&nbsp;&nbsp;${p.day}일</div>

  <div class="${signBreak}">
    <div class="sign-area">
      <div class="sign-lines">
        ${sigRow("(공단/위탁기관) 담당자", sigs.govAgent?.name ?? "", sigs.govAgent?.imageUrl)}
        ${sigRow("사업체담당자", "", sigs.companyManager?.imageUrl)}
        ${sigRow("직무지도원", sigs.worker?.name ?? "", sigs.worker?.imageUrl)}
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}
