// lib/pdf/templates-html/ADAPTATION_DAILY_LOG.ts
// 취업 후 적응지도 일지 — jsreport 원본 1:1 이식
import { buildHcrFontFaceCss } from "../engine/fontEmbed";

export type AdaptationDailyLogEntry = {
  dateISO?: string;
  dateMD?: string;
  attendance?: string;
  workTime?: string;
  guidance?: string;
  task?: string;
  performanceLabel?: string;
  performanceTime?: string;
  coaching?: string;
};

export type AdaptationDailyLogPayload = {
  traineeName: string;
  companyName: string;
  periodStart: string;  // YYYY-MM-DD or YYYY.MM.DD
  periodEnd:   string;
  issues?: string;
  holidays?: string[];
  defaultWorkTime?: string;
  entries?: AdaptationDailyLogEntry[];
  signatureNewPage?: boolean;
  signatures?: {
    coach?:     { name?: string; imageUrl?: string };
    govAgent?:  { name?: string; imageUrl?: string };
  };
};

// ── beforeRender 로직 ─────────────────────────────────────────
function pad2(n: number): string { return String(n).padStart(2, "0"); }

function parseYmd(str: string | undefined): Date | null {
  if (!str) return null;
  const s = String(str).trim().replace(/\./g, "-").replace(/\//g, "-");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;
  return dt;
}

function fmtDot(dt: Date): string {
  return `${dt.getUTCFullYear()}.${pad2(dt.getUTCMonth()+1)}.${pad2(dt.getUTCDate())}`;
}

function fmtMD(dt: Date): string {
  return `${pad2(dt.getUTCMonth()+1)}/${pad2(dt.getUTCDate())}`;
}

function isWeekend(dt: Date): boolean {
  const d = dt.getUTCDay(); return d === 0 || d === 6;
}

function ymdKey(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`;
}

function preparePayload(p: AdaptationDailyLogPayload) {
  const pStart = parseYmd(p.periodStart);
  const pEnd   = parseYmd(p.periodEnd);
  const holidays = new Set((p.holidays ?? []).map(s => String(s).trim().replace(/\./g,"-").replace(/\//g,"-")));

  const periodStartFmt = pStart ? fmtDot(pStart) : p.periodStart;
  const periodEndFmt   = pEnd   ? fmtDot(pEnd)   : p.periodEnd;

  // 워킹데이 계산
  let workingDays = 0;
  if (pStart && pEnd) {
    const cur = new Date(pStart.getTime());
    while (cur.getTime() <= pEnd.getTime()) {
      if (!isWeekend(cur) && !holidays.has(ymdKey(cur))) workingDays++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  // entries 자동 생성 또는 dateMD 보정
  let entries = Array.isArray(p.entries) && p.entries.length > 0 ? [...p.entries] : [];
  if (entries.length === 0 && pStart && pEnd) {
    const cur = new Date(pStart.getTime());
    while (cur.getTime() <= pEnd.getTime()) {
      const key = ymdKey(cur);
      if (!isWeekend(cur) && !holidays.has(key)) {
        entries.push({ dateISO: key, dateMD: fmtMD(cur), workTime: p.defaultWorkTime ?? "00:00~00:00", attendance:"", guidance:"", task:"", performanceLabel:"", performanceTime:"", coaching:"" });
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else {
    entries = entries.map(e => {
      const out = { ...e };
      if (!out.dateMD) {
        const dt = parseYmd(out.dateISO);
        if (dt) out.dateMD = fmtMD(dt);
      }
      if (!out.workTime) out.workTime = p.defaultWorkTime ?? "00:00~00:00";
      return out;
    });
  }

  // 서명 위치 계산
  const PAGE_H = 232;
  const INFO_H = 18, GAPS_H = 10, THEAD_H = 15, ROW_H = 14, ISSUE_H = 18, SIGN_H = 26;
  const availFirst = Math.max(0, PAGE_H - INFO_H - GAPS_H - THEAD_H - ISSUE_H);
  const rowsFirst  = Math.max(0, Math.floor(availFirst / ROW_H));
  const availNext  = Math.max(0, PAGE_H - THEAD_H - ISSUE_H);
  const rowsNext   = Math.max(1, Math.floor(availNext / ROW_H));
  const n = entries.length;
  let rowsOnLast = 0;
  if (n <= rowsFirst) { rowsOnLast = n; }
  else { const tail = (n - rowsFirst) % rowsNext; rowsOnLast = tail === 0 ? rowsNext : tail; }
  const usedLast = THEAD_H + rowsOnLast * ROW_H + ISSUE_H;
  const signatureNewPage = p.signatureNewPage ?? ((PAGE_H - usedLast) < SIGN_H);

  return { ...p, periodStart: periodStartFmt, periodEnd: periodEndFmt, workingDays, entries, signatureNewPage };
}

function sigRow(label: string, name: string, imgUrl?: string): string {
  const img = imgUrl ? `<img class="sign-img" src="${imgUrl}" />` : "";
  return `<div class="sign-row">
    <span class="sign-label"><span class="tx95m5">${label}</span></span>
    <span class="sign-colon">:</span>
    <span class="sign-slot"><span class="tx95m5">${name}</span></span>
    <span class="sign-text"><span class="tx95m5">(서명 또는 인)</span>${img}</span>
  </div>`;
}

export function renderADAPTATION_DAILY_LOG_HTML(raw: AdaptationDailyLogPayload): string {
  const p = preparePayload(raw);
  const fontCss = buildHcrFontFaceCss("35mm 24mm 30mm 26.5mm");
  const sigs = p.signatures ?? {};

  const rowsHtml = p.entries.length > 0
    ? p.entries.map((e, i) => `
    <tr class="row-min">
      <td class="vcell"><span class="vtext">${i === 0 ? "적응지도" : "〃"}</span></td>
      <td class="date-cell"><span class="tx95m5">${e.dateMD ?? ""}</span></td>
      <td class="att-cell"><span class="tx95m5">${e.attendance ?? ""}</span></td>
      <td class="center"><span class="tx95m5">${e.workTime ?? ""}</span></td>
      <td class="center"><span class="tx95m5">${e.guidance ?? ""}</span></td>
      <td class="left"><span class="tx95m5">${e.task ?? ""}</span></td>
      <td class="center">
        <div><span class="tx95m5">${e.performanceLabel ?? ""}</span></div>
        <div><span class="tx95m5">(${e.performanceTime ?? ""})</span></div>
      </td>
      <td class="left"><span class="tx95m5">${e.coaching ?? ""}</span></td>
    </tr>`).join("\n")
    : `<tr class="row-min">
      <td class="vcell"><span class="vtext">적응지도</span></td>
      <td class="date-cell"></td><td class="att-cell"></td>
      <td class="center"></td><td class="center"></td>
      <td class="left"></td><td class="center"></td><td class="left"></td>
    </tr>`;

  const signBreak = p.signatureNewPage ? "sign-break" : "";

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<style>
${fontCss}
body { color:#000; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

.tx97m15 { display:inline-block; transform:scaleX(0.97); transform-origin:left center; letter-spacing:-0.15em; }
.tx95m5  { display:inline-block; transform:scaleX(0.95); transform-origin:center center; letter-spacing:-0.05em; }
.tx95m9  { display:inline-block; transform:scaleX(0.95); transform-origin:center center; letter-spacing:-0.09em; }

.note { font-family:"HCRDotum",sans-serif; font-size:8pt; line-height:1.8; margin:0 0 2mm 0; }
.doc-title {
  text-align:center; font-family:"HCRBatang",serif; font-size:14pt; font-weight:700;
  letter-spacing:0; line-height:0.8; margin:0 0 3pt 0; width:100%; position:relative;
  transform:translateX(-1.25mm);
}
.gap-after-title { height:14pt; margin:0 0 3pt 0; }
.sheet { width:159.5mm; margin:0; }

table { width:100%; border-collapse:collapse; table-layout:fixed; border:0.10mm solid #555; }
th, td { padding:0; vertical-align:middle; border-right:0.06mm solid #555; border-bottom:0.06mm solid #555; }
tr > *:last-child { border-right:none; }
.pad { padding:1.4mm 1.6mm; }
.center { text-align:center; }
.left   { text-align:left; }

.info { font-family:"HCRDotum",sans-serif; font-size:11pt; line-height:1.0; }
.info th { height:5.87mm; background:#fff; font-weight:700; }
.info td { height:10.51mm; }
.info .cell { text-align:center; }
.info .periodCell { padding:0.8mm 1.2mm; text-align:center; white-space:nowrap; }
.gap-after-info { height:14pt; margin:0 0 3pt 0; }

.log { font-family:"HCRDotum",sans-serif; font-size:11pt; }
.log thead th { background:#fff; font-weight:700; text-align:center; line-height:1.0; padding:1.0mm 0.6mm; border-bottom:0.10mm solid #555; }
thead { display:table-header-group; }
tr { break-inside:avoid; page-break-inside:avoid; }
.c1{width:6.84mm;}.c2{width:10.93mm;}.c3{width:17.75mm;}.c4{width:22.50mm;}
.c5{width:19.57mm;}.c6{width:21.57mm;}.c7{width:18.69mm;}.c8{width:41.66mm;}
.log tbody td { padding:1.2mm 0.6mm; vertical-align:middle; line-height:1.25; }
.row-min { min-height:14mm; }

.vcell { text-align:center; vertical-align:middle; padding:0 !important; }
.vtext { display:inline-block; font-family:"HCRDotum",sans-serif; font-size:11pt;
  line-height:1.25; transform:scaleX(0.95); transform-origin:center center;
  letter-spacing:-0.05em; writing-mode:vertical-rl; text-orientation:upright; }
.date-cell { text-align:center; vertical-align:middle; }
.att-cell  { text-align:center; vertical-align:middle; line-height:0.9;
  padding-top:0.6mm !important; padding-bottom:0.6mm !important; }
.vtext-issue { display:inline-block; font-family:"HCRDotum",sans-serif; font-size:11pt;
  line-height:1.3; transform:scaleX(0.95); transform-origin:center center;
  letter-spacing:-0.05em; writing-mode:vertical-rl; text-orientation:upright; }
.issue-cell { text-align:left; vertical-align:middle;
  padding:2.0mm 0.6mm 2.0mm 1.2mm !important; line-height:1.35; letter-spacing:-0.05em; word-break:keep-all; }

.sign-break { page-break-before:always; break-before:page; }
.sign-area  { margin-top:12pt; break-inside:avoid; page-break-inside:avoid;
  font-family:"HCRDotum",sans-serif; font-size:12pt; line-height:1.45; }
.sign-lines { width:100%; }
.sign-row   { display:grid; grid-template-columns:95mm 6mm 1fr auto; align-items:center; height:8mm; white-space:nowrap; }
.sign-label { text-align:right; padding-right:1mm; }
.sign-colon { text-align:center; }
.sign-slot  { white-space:nowrap; display:inline-flex; align-items:center; position:relative; padding-left:2mm; }
.sign-text  { position:relative; display:inline-block; white-space:nowrap; min-width:28mm; text-align:center; z-index:0; }
.sign-img   { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  width:28mm; height:20mm; object-fit:contain; opacity:0.6; pointer-events:none; z-index:1; }
.sign-gap   { height:4pt; }
</style>
</head>
<body>
  <div class="note"><span class="tx97m15">[붙임 24] 직무지도원을 활용한 취업 후 적응지도 일지</span></div>
  <div class="doc-title">직무지도원을 활용한 취업 후 적응지도 일지</div>
  <div class="gap-after-title"></div>
  <div class="sheet">
    <table class="info">
      <colgroup>
        <col style="width:29.61mm;"><col style="width:68.29mm;"><col style="width:61.60mm;">
      </colgroup>
      <thead>
        <tr>
          <th class="center"><span class="tx95m5">근로자명</span></th>
          <th class="center"><span class="tx95m5">사업체명</span></th>
          <th class="center"><span class="tx95m5">적응지도기간</span></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="cell pad"><span class="tx95m5">${p.traineeName}</span></td>
          <td class="cell pad"><span class="tx95m5">${p.companyName}</span></td>
          <td class="periodCell"><span class="tx95m5">${p.periodStart} ~ ${p.periodEnd} (${p.workingDays})일</span></td>
        </tr>
      </tbody>
    </table>
    <div class="gap-after-info"></div>
    <table class="log">
      <colgroup>
        <col class="c1"><col class="c2"><col class="c3"><col class="c4">
        <col class="c5"><col class="c6"><col class="c7"><col class="c8">
      </colgroup>
      <thead>
        <tr>
          <th><span class="tx95m5">구<br/>분</span></th>
          <th><span class="tx95m5">지도<br/>일자</span></th>
          <th><span class="tx95m9">출석/<br/>결석/<br/>지각/<br/>조퇴</span></th>
          <th><span class="tx95m5">근무시간</span></th>
          <th><span class="tx95m5">출퇴근<br/>지도 및<br/>휴게시간<br/>지도 여부</span></th>
          <th><span class="tx95m5">수행과제</span></th>
          <th><span class="tx95m5">수행정도<br/>(측정시간)</span></th>
          <th><span class="tx95m5">지도사항</span></th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr>
          <td class="vcell"><span class="vtext-issue">특이사항</span></td>
          <td class="issue-cell" colspan="7"><span class="tx95m5">${p.issues ?? ""}</span></td>
        </tr>
      </tbody>
    </table>
    <div class="${signBreak}">
      <div class="sign-area">
        <div class="sign-lines">
          ${sigRow("직무지도원", sigs.coach?.name ?? "", sigs.coach?.imageUrl)}
          <div class="sign-gap"></div>
          ${sigRow("위탁기관 담당자", sigs.govAgent?.name ?? "", sigs.govAgent?.imageUrl)}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
