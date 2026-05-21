// lib/pdf/templates-html/TRAINING_DAILY_LOG.ts
import { buildHcrFontFaceCss } from "../engine/fontEmbed";

type Section = "PRE" | "FIELD";

export type TrainingDailyLogRow = {
  section: Section;
  date: string; // YYYY-MM-DD
  attendanceStatus?: string;
  trainingTime?: string;
  commute?: string;
  guidanceFlag?: string;
  task?: string;
  taskLevelMeasured?: string;
  evalGuidance?: string;
};

export type TrainingDailyLogPayload = {
  traineeName: string;
  companyName: string;

  // 훈련기간(상단 메타)
  periodPreText: string;   // 표시용 텍스트(사전)
  periodFieldText: string; // 표시용 텍스트(현장)

  // 자동 행 생성(현장훈련)
  fieldStartDate?: string; // YYYY-MM-DD
  fieldEndDate?: string;   // YYYY-MM-DD
  holidays?: string[];     // YYYY-MM-DD 목록 (주말+공휴일 제외)
  preDays?: number;        // 사전훈련 일수(기본 1). preStartDate가 없으면 단순히 n일 빈행
  preStartDate?: string;   // YYYY-MM-DD (선택)

  // 이미 저장된 rows가 있으면 우선 사용(없으면 자동 생성)
  rows?: TrainingDailyLogRow[];
};

function isWeekend(d: Date) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function parseYmd(s: string) {
  // YYYY-MM-DD (local date)
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function buildWorkingDays(start: string, end: string, holidays: Set<string>) {
  const s = parseYmd(start);
  const e = parseYmd(end);
  const out: string[] = [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const ymd = toYmd(d);
    if (isWeekend(d)) continue;
    if (holidays.has(ymd)) continue;
    out.push(ymd);
  }
  return out;
}

function buildRows(p: TrainingDailyLogPayload): TrainingDailyLogRow[] {
  if (p.rows && p.rows.length) return p.rows;

  const holidays = new Set((p.holidays ?? []).filter(Boolean));
  const rows: TrainingDailyLogRow[] = [];

  // 1) 사전훈련: 대부분 1일, 가끔 2일 이상
  const preDays = Math.max(1, p.preDays ?? 1);
  if (p.preStartDate) {
    const s = parseYmd(p.preStartDate);
    for (let i = 0; i < preDays; i++) {
      const d = new Date(s);
      d.setDate(d.getDate() + i);
      rows.push({ section: "PRE", date: toYmd(d) });
    }
  } else {
    // 시작일이 없으면 날짜는 빈칸(양식만)
    for (let i = 0; i < preDays; i++) rows.push({ section: "PRE", date: "" });
  }

  // 2) 현장훈련: 워킹데이 수만큼 자동 생성
  if (p.fieldStartDate && p.fieldEndDate) {
    const days = buildWorkingDays(p.fieldStartDate, p.fieldEndDate, holidays);
    for (const ymd of days) rows.push({ section: "FIELD", date: ymd });
  } else {
    // 기간이 없으면 최소 1행은 남김(양식 유지)
    rows.push({ section: "FIELD", date: "" });
  }

  return rows;
}

function groupByRun(rows: TrainingDailyLogRow[]) {
  const runs: { section: Section; start: number; count: number }[] = [];
  rows.forEach((r, i) => {
    const last = runs[runs.length - 1];
    if (!last || last.section !== r.section) runs.push({ section: r.section, start: i, count: 1 });
    else last.count += 1;
  });
  return runs;
}

export function renderTRAINING_DAILY_LOG_HTML(payload: TrainingDailyLogPayload) {
  const fontCss = buildHcrFontFaceCss("20mm 18mm 15mm 30mm");
  const rows = buildRows(payload);
  const runs = groupByRun(rows);

  // rowSpan 계산용 맵: 시작 인덱스에만 rowSpan 부여
  const rowSpanAt = new Map<number, number>();
  for (const r of runs) rowSpanAt.set(r.start, r.count);

  const sectionLabel = (sec: Section) => (sec === "PRE" ? "사전훈련" : "현장훈련");

  // 원본 느낌: 얇은 선 + 고정 행 높이
  // 세로 헤더는 회전 대신 <br>로 적층
  const htmlRows = rows
    .map((r, idx) => {
      const span = rowSpanAt.get(idx);
      const tdSection = span
        ? `<td class="td-section" rowspan="${span}">${sectionLabel(r.section).split("").join("<br/>")}</td>`
        : "";

      return `
<tr>
  ${tdSection}
  <td class="td-date">${r.date ? r.date.replace(/-/g, "-") : ""}</td>
  <td class="td-status">${r.attendanceStatus ?? ""}</td>
  <td class="td-time">${r.trainingTime ?? ""}</td>
  <td class="td-commute">${r.commute ?? ""}</td>
  <td class="td-flag">${r.guidanceFlag ?? ""}</td>
  <td class="td-task">${r.task ?? ""}</td>
  <td class="td-level">${r.taskLevelMeasured ?? ""}</td>
  <td class="td-eval">${r.evalGuidance ?? ""}</td>
</tr>`.trim();
    })
    .join("\n");

  // 서명 블록은 원본처럼 하단에 위치하도록 min-height를 주고, 마지막에 배치
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    ${fontCss}

    @page { size: A4; margin: 12mm; }
    html, body { padding: 0; margin: 0; }
    body {
      font-family: "HCRDotum", "Dotum", sans-serif;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      width: 100%;
      min-height: 271mm; /* A4 height - margins 정도로 체감상 맞추기 */
      display: flex;
      flex-direction: column;
    }

    .title {
      text-align: center;
      font-weight: 700;
      font-size: 16px;
      margin-top: 6mm;
      margin-bottom: 6mm;
    }

    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    td, th { border: 1px solid #000; padding: 0; }

    /* 메타 테이블 */
    .meta th { font-size: 11px; font-weight: 700; height: 8mm; }
    .meta td { font-size: 11px; height: 8mm; text-align: center; }
    .meta .period-head { font-weight: 700; }
    .meta .period-label { width: 14mm; }
    .meta .period-value { text-align: left; padding-left: 2mm; }

    /* 본문 테이블 */
    .main { margin-top: 4mm; }
    .main th {
      font-size: 10px;
      font-weight: 700;
      text-align: center;
      vertical-align: middle;
      height: 16mm; /* 헤더 높이 고정 */
      line-height: 1.2;
    }
    .main td {
      font-size: 10px;
      vertical-align: middle;
      height: 18mm; /* 행 높이 고정 (원본처럼 큼) */
      line-height: 1.2;
      padding: 1mm;
    }

    /* 컬럼 폭(원본 비율 근사) */
    .col-section { width: 7mm; }        /* 구분 */
    .col-date    { width: 18mm; }       /* 훈련일자 */
    .col-status  { width: 12mm; }       /* 출석... */
    .col-time    { width: 12mm; }       /* 훈련시간 */
    .col-commute { width: 12mm; }       /* 출퇴근 */
    .col-flag    { width: 12mm; }       /* 지도여부 */
    .col-task    { width: 32mm; }       /* 수행과제 */
    .col-level   { width: 22mm; }       /* 수행정도 */
    /* 평가 및 지도사항은 잔여 */

    .td-section { text-align: center; font-weight: 700; }
    .td-date, .td-status, .td-time, .td-commute, .td-flag { text-align: center; }
    .td-task, .td-level, .td-eval { text-align: left; vertical-align: top; }

    /* 하단 서명 */
    .footer {
      margin-top: auto;
      padding-top: 10mm;
      font-size: 10px;
    }
    .sig-row {
      display: flex;
      justify-content: space-between;
      width: 55%;
      margin-left: auto;
      margin-right: auto;
      line-height: 1.8;
    }
  </style>
</head>

<body>
  <div class="page">
    <div class="title">지원고용 훈련일지</div>

    <!-- 메타 -->
    <table class="meta">
      <colgroup>
        <col style="width: 24%"/>
        <col style="width: 36%"/>
        <col style="width: 40%"/>
      </colgroup>
      <tr>
        <th>훈련생명</th>
        <th>사업체명</th>
        <th class="period-head">훈 련 기 간</th>
      </tr>
      <tr>
        <td>${payload.traineeName || "-"}</td>
        <td>${payload.companyName || "-"}</td>
        <td style="padding:0;">
          <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
            <colgroup>
              <col class="period-label"/>
              <col/>
            </colgroup>
            <tr>
              <td style="border:1px solid #000; text-align:center;">사전</td>
              <td style="border:1px solid #000;" class="period-value">${payload.periodPreText || "-"}</td>
            </tr>
            <tr>
              <td style="border:1px solid #000; text-align:center;">현장</td>
              <td style="border:1px solid #000;" class="period-value">${payload.periodFieldText || "-"}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- 본문 테이블 -->
    <table class="main">
      <colgroup>
        <col class="col-section"/>
        <col class="col-date"/>
        <col class="col-status"/>
        <col class="col-time"/>
        <col class="col-commute"/>
        <col class="col-flag"/>
        <col class="col-task"/>
        <col class="col-level"/>
        <col/>
      </colgroup>
      <tr>
        <th>구<br/>분</th>
        <th>훈련<br/>일자</th>
        <th>출석/<br/>결석/<br/>지각/<br/>조퇴</th>
        <th>훈련<br/>시간</th>
        <th>출퇴<br/>근</th>
        <th>지도<br/>및<br/>휴게<br/>시간<br/>지도<br/>여부</th>
        <th>수행과제</th>
        <th>수행정도<br/>(측정시간)</th>
        <th>평가 및 지도사항</th>
      </tr>

      ${htmlRows}
    </table>

    <!-- 서명 -->
    <div class="footer">
      <div class="sig-row"><div>(공단/위탁기관) 담당자:</div><div>(서&nbsp;&nbsp;명)</div></div>
      <div class="sig-row"><div>사업체담당자:</div><div>(서&nbsp;&nbsp;명)</div></div>
      <div class="sig-row"><div>직무지도원:</div><div>(서&nbsp;&nbsp;명)</div></div>
    </div>
  </div>
</body>
</html>
  `.trim();
}
