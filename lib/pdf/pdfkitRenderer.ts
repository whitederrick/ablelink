// lib/pdf/pdfkitRenderer.ts
// 브라우저 없이(서버리스 안전) PDF 생성 — pdfkit + NotoSansKR.
// 기존 Playwright(chromium) 엔진은 Vercel 서버리스에서 동작 불가 → 대체.
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const FONT_DIR = path.join(process.cwd(), "public", "fonts");

// A4 (pt). 1mm ≈ 2.83465pt
const MM = 2.83465;
function mm(v: number): number { return v * MM; }
const MARGIN = 40;

// 원본 공식 양식과 동일한 HCR 폰트(HCR돋움=본문, HCR바탕=제목/소제목).
// 파일이 크므로(20~31MB) 모듈 스코프에 버퍼 캐시(warm 인스턴스 재사용).
const fontCache: Record<string, Buffer> = {};
function loadFont(file: string): Buffer {
  if (!fontCache[file]) fontCache[file] = fs.readFileSync(path.join(FONT_DIR, file));
  return fontCache[file];
}

type Sig = { name?: string; imageUrl?: string };

// PNG 헤더(IHDR)에서 이미지 픽셀 크기 읽기. (직인=정사각 판별용. PNG 아니면 null)
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function newDoc(marginMm?: number): PDFKit.PDFDocument {
  const m = marginMm != null ? mm(marginMm) : MARGIN;
  const doc = new PDFDocument({ size: "A4", margins: { top: m, bottom: m, left: m, right: m } });
  // 본문 기본 = HCR돋움
  doc.registerFont("KR", loadFont("HCRDotum.ttf"));
  doc.registerFont("KR-Bold", loadFont("HCRDotum-Bold.ttf"));
  // 제목/소제목 = HCR바탕
  doc.registerFont("Batang", loadFont("HCRBatang.ttf"));
  doc.registerFont("Batang-Bold", loadFont("HCRBatang-Bold.ttf"));
  doc.font("KR").fillColor("#000");
  return doc;
}

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

type CellOpts = {
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: number;
  fill?: string;
  vertical?: boolean;
  pad?: number;
  border?: boolean;
  lineGap?: number; // 여러 줄 텍스트 줄간격(음수면 더 좁게)
};

// 셀 박스 + 세로중앙 텍스트
function cell(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, text: string | number | null | undefined, o: CellOpts = {}) {
  const { align = "center", bold = false, size = 9, fill, vertical = false, pad = 2, border = true, lineGap = 0 } = o;
  if (fill) doc.save().rect(x, y, w, h).fill(fill).restore();
  if (border) doc.lineWidth(0.6).rect(x, y, w, h).stroke("#000");
  const t = text == null ? "" : String(text);
  if (!t) return;
  doc.font(bold ? "KR-Bold" : "KR").fontSize(size).fillColor("#000");
  if (vertical) {
    const chars = [...t];
    const ch = size * 1.18;
    let ty = y + Math.max(0, (h - chars.length * ch) / 2);
    for (const c of chars) { doc.text(c, x, ty, { width: w, align: "center" }); ty += ch; }
    return;
  }
  const tw = w - pad * 2;
  const th = doc.heightOfString(t, { width: tw, align, lineGap });
  const ty = y + Math.max(0, (h - th) / 2);
  doc.text(t, x + pad, ty, { width: tw, align, lineGap });
}

function title(doc: PDFKit.PDFDocument, text: string, y: number, size = 17, opts: { x?: number; w?: number; font?: string; gap?: number } = {}): number {
  const x = opts.x ?? MARGIN;
  const w = opts.w ?? (doc.page.width - MARGIN * 2);
  doc.font(opts.font ?? "Batang-Bold").fontSize(size).fillColor("#000");
  doc.text(text, x, y, { width: w, align: "center" });
  return y + doc.heightOfString(text, { width: w, align: "center" }) + (opts.gap ?? 10);
}

// 서명란 (라벨: 이름 (서명 또는 인)[+이미지])
// right/left를 주면 위쪽 표의 우측 끝에 맞춰 정렬(출근부는 20mm 여백이라 기본값과 다름).
function signatures(
  doc: PDFKit.PDFDocument, y: number, rows: { label: string; sig?: Sig }[],
  opts: { tail?: string; left?: number; right?: number } = {},
): number {
  const { tail = "(서명 또는 인)", left = MARGIN, right = doc.page.width - MARGIN } = opts;
  // 서명 블록이 페이지 하단 여백을 넘으면 다음 페이지로(자동 흘림 방지)
  if (y + rows.length * 24 + 12 > pageBottom(doc)) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  let cy = y + 6;
  doc.fontSize(11);
  for (const r of rows) {
    const name = r.sig?.name ?? "";
    const line = `${r.label} : ${name}    ${tail}`;
    doc.font("KR").fontSize(11).fillColor("#000").text(line, left, cy, { width: right - left, align: "right" });
    // 서명 이미지(있으면) "(서명 또는 인)" 텍스트 중앙에 겹쳐 그림
    if (r.sig?.imageUrl && r.sig.imageUrl.startsWith("data:image")) {
      try {
        const b64 = r.sig.imageUrl.split(",")[1];
        const img = Buffer.from(b64, "base64");
        const tailW = doc.widthOfString(tail);     // "(서명 또는 인)" / "(서 명)" 폭
        const tailCx = right - tailW / 2;          // 우측정렬이라 tail은 right에서 끝남 → 중앙
        const imgW = Math.min(78, tailW + 20), imgH = 26;
        doc.image(img, tailCx - imgW / 2, cy - 7, { fit: [imgW, imgH], align: "center", valign: "center" });
      } catch { /* 이미지 실패 무시 */ }
    }
    cy += 24;
  }
  return cy;
}

function pageBottom(doc: PDFKit.PDFDocument): number {
  // ⚠️ 실제 페이지 하단 여백 기준(문서마다 newDoc(mm) 여백이 다름). 전역 MARGIN로 계산하면
  //    하단 여백 안에 행이 그려져 pdfkit이 셀 텍스트를 자동으로 다음 페이지로 흘려보내(셀 흩어짐) 깨진다.
  return doc.page.height - doc.page.margins.bottom;
}

// ── 출근부 주차 그리드 유틸 (원본 ATTENDANCE_SHEET 로직 이식) ──
function normYmd(s: string | null | undefined): string {
  const t = String(s ?? "").trim().replace(/[./]/g, "-");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function dowMon0(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
function mdLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}
type WeekCell = { ymd: string | null; e: any };

// 주말 제외 평일 수 (적응지도 일지 (N)일 표기용)
function countWeekdays(start: string, end: string): number | null {
  if (!start || !end || start > end) return null;
  let n = 0, cur = start;
  while (cur <= end) {
    const [y, m, d] = cur.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
    cur = addDaysYmd(cur, 1);
  }
  return n;
}

// 훈련일지 일자 셀 표기: 2026/\n01/05
function fmtTrainingDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${y}/\n${m}/${d}`;
}
// 적응지도 일자 셀 표기: 01/05 (영점패딩, 연도 없음)
function mdSlash(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${m}/${d}`;
}

// 총 지도시간 셀: 3줄(시작 / ~끝 / (Xh)) — HCR돋움
function drawTimeCell(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, e: any) {
  doc.lineWidth(0.6).rect(x, y, w, h).stroke("#000");
  // 급여 게이트: 심한 지각/조퇴 미컨펌(보정대기)인 날은 기본 시각을 박지 않고 "보정대기"만 표시.
  if (e?.pending) {
    const lineH = 10.2;
    doc.font("KR").fontSize(8).fillColor("#b91c1c");
    const ty = y + Math.max(0, (h - lineH) / 2);
    doc.text("보정대기", x, ty, { width: w, align: "center" });
    doc.fillColor("#000");
    return;
  }
  const s = e?.start ?? e?.startTime ?? "";
  const en = e?.end ?? e?.endTime ?? "";
  const hrs = e?.hours ?? e?.totalHours;
  const l1 = s || ":";
  const l2 = `~ ${en || ":"}`;
  const l3 = hrs != null && hrs !== "" ? `(${hrs}h)` : "(h)";
  doc.font("KR").fontSize(9).fillColor("#000");
  const lineH = 10.2;
  let ty = y + Math.max(0, (h - lineH * 3) / 2);
  doc.text(l1, x, ty, { width: w, align: "center" }); ty += lineH;
  doc.text(l2, x, ty, { width: w, align: "center" }); ty += lineH;
  doc.text(l3, x + 1, ty, { width: w - mm(1), align: "right" });
}

// ── 1) 출근부 ───────────────────────────────────────────────
// 원본 사양: 폭 170mm, 좌우여백 20mm. 제목 HCR바탕 19pt, 본문 HCR돋움.
function attendanceSheet(p: any): Promise<Buffer> {
  const doc = newDoc(20);
  const x = mm(20), W = mm(170);
  let y = title(doc, "직무지도원 출근부", mm(16), 19, { x, w: W, gap: mm(4) });

  // 정보 표 (4열, 원본 35:50:35:50 mm). 라벨 HCR돋움 정체(굵게 아님)
  const lc = mm(35), vc = mm(50);
  const info: { label: string; value: string; label2: string; value2: string; h: number }[] = [
    { label: "성    명", value: p.workerName ?? "", label2: "연락처", value2: p.workerPhone ?? "", h: mm(7) },
    { label: "배치사업체명", value: p.companyName ?? "", label2: "지도기간", value2: `${p.periodStartYMD ?? ""}\n~ ${p.periodEndYMD ?? ""}`, h: mm(11) },
    { label: "지도일수 및 시간\n(주휴미포함)", value: `총 ${p.totalDays ?? 0} 일,  총 ${p.totalHours ?? 0} h`, label2: "주휴수당 등", value2: `주휴 ${p.weeklyHolidayCount ?? 0} 회   월차 ${p.monthlyLeaveCount ?? 0} 회\n총 ${p.allowanceTotalWon ?? 0} 원`, h: mm(11) },
    { label: "일반 지도시간\n(1:1 지도시간)", value: `총 ${p.oneToOneHours ?? 0} h`, label2: "1:多 지도시간\n(2인 이상)", value2: `총 ${p.oneToManyHours ?? 0} h`, h: mm(10) },
    { label: "연장 지도시간\n(1:1 지도시간)", value: `총 ${p.otOneToOneHours ?? 0} h`, label2: "연장 1:多 지도 시간\n(2인 이상)", value2: `총 ${p.otOneToManyHours ?? 0} h`, h: mm(10) },
  ];
  for (const r of info) {
    cell(doc, x, y, lc, r.h, r.label, { size: 10 });
    cell(doc, x + lc, y, vc, r.h, r.value, { size: 10 });
    cell(doc, x + lc + vc, y, lc, r.h, r.label2, { size: 10 });
    cell(doc, x + lc * 2 + vc, y, W - lc * 2 - vc, r.h, r.value2, { size: 10 });
    y += r.h;
  }

  y += mm(2.5);
  doc.font("KR").fontSize(10).fillColor("#000").text("※ 주휴수당은 위탁기관 담당자가 작성", x, y);
  y += mm(9);
  doc.font("Batang").fontSize(12).fillColor("#000").text("■ 근무상황표", x, y); y += mm(7);

  // 근무상황표: 월~일 주차 그리드 (일자 / 총 지도시간 / 1:多 지도)
  const start = normYmd(p.periodStartYMD), end = normYmd(p.periodEndYMD);
  const entries: any[] = Array.isArray(p.entries) ? p.entries : [];
  const map = new Map<string, any>();
  for (const e of entries) {
    const key = normYmd(e.date ?? e.workDate ?? "");
    if (key) map.set(key, e);
  }
  const weeks: WeekCell[][] = [];
  if (start && end) {
    let cur = addDaysYmd(start, -dowMon0(start));
    while (cur <= end) {
      const week: WeekCell[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDaysYmd(cur, i);
        if (d < start || d > end) week.push({ ymd: null, e: null });
        else week.push({ ymd: d, e: map.get(d) ?? null });
      }
      weeks.push(week);
      cur = addDaysYmd(cur, 7);
    }
  }

  const labelW = mm(22);
  const dayW = (W - labelW) / 7;
  const dayNames = ["월", "화", "수", "목", "금", "토", "일"];
  const headH = mm(5), dateH = mm(5), totalH = mm(12), multiH = mm(5);
  const drawGridHeader = () => {
    cell(doc, x, y, labelW, headH, "구분", { bold: true, size: 10.5 });
    dayNames.forEach((d, i) => cell(doc, x + labelW + dayW * i, y, dayW, headH, d, { bold: true, size: 10.5 }));
    y += headH;
  };
  drawGridHeader();
  for (const week of weeks) {
    if (y + dateH + totalH + multiH > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; drawGridHeader(); }
    // 일자
    cell(doc, x, y, labelW, dateH, "일자", { size: 10 });
    week.forEach((c, i) => cell(doc, x + labelW + dayW * i, y, dayW, dateH, c.ymd ? mdLabel(c.ymd) : "/", { size: 10 }));
    y += dateH;
    // 총 지도시간
    cell(doc, x, y, labelW, totalH, "총\n지도시간", { size: 10 });
    week.forEach((c, i) => drawTimeCell(doc, x + labelW + dayW * i, y, dayW, totalH, c.e));
    y += totalH;
    // 1:多 지도
    cell(doc, x, y, labelW, multiH, "1:多 지도", { size: 10 });
    week.forEach((c, i) => {
      const mv = c.e ? (c.e.multiHours ?? c.e.oneToManyHours) : "";
      cell(doc, x + labelW + dayW * i, y, dayW, multiH, mv ? `(${mv}h)` : "(h)", { size: 10 });
    });
    y += multiH;
  }

  y += mm(6);
  doc.font("KR").fontSize(11).fillColor("#000").text("위와 같이 근무(출근) 하였음을 확인함", x, y, { width: W, align: "center" }); y += mm(6);
  const today = new Date();
  doc.text(`${today.getFullYear()}년     ${today.getMonth() + 1}월     ${today.getDate()}일`, x, y, { width: W, align: "center" }); y += mm(13);

  const s = p.signatures ?? {};
  signatures(doc, y, [
    { label: "(공단/위탁기관) 담당자", sig: s.govAgent },
    { label: "사업체담당자", sig: s.companyManager },
    { label: "직무지도원", sig: s.worker },
  ], { left: x, right: x + W });
  return toBuffer(doc);
}

// 일지 본문 8열 테이블 — 구분 열 세로글자 + 동일 구분 연속 시 〃, 헤더 페이지 반복
type DailyRow = { sectionKey: string; sectionLabel: string; cells: string[]; lefts?: boolean[] };
function dailyLogTable(
  doc: PDFKit.PDFDocument,
  x: number, top: number, widths: number[],
  headers: string[], rows: DailyRow[],
  // mergedLabel: 단일 구분(적응지도)을 매 행이 아닌 전체 행을 가로지르는 1셀로 병합(원본 동일).
  opts: { headerH?: number; minRowH?: number; size?: number; headerSize?: number; headerLineGap?: number; mergedLabel?: string } = {},
): number {
  const { headerH = 42, minRowH = 42, size = 8.5, headerSize = 8, headerLineGap = 0, mergedLabel } = opts;
  let y = top;
  const drawHeader = () => {
    let cx = x;
    headers.forEach((h, i) => { cell(doc, cx, y, widths[i], headerH, h, { bold: true, size: headerSize, fill: "#d9d9d9", lineGap: headerLineGap }); cx += widths[i]; });
    y += headerH;
  };
  // 병합 구분 라벨: [segStartY, endY] 구간의 구분 열에 세로 텍스트 1개 + 외곽 박스
  let segStartY = 0;
  const drawMerged = (endY: number) => {
    if (!mergedLabel || endY <= segStartY) return;
    const h = endY - segStartY;
    doc.save().lineWidth(0.6).rect(x, segStartY, widths[0], h).stroke("#000").restore();
    doc.font("KR-Bold").fontSize(size).fillColor("#000");
    const chars = [...mergedLabel];
    const ch = size * 1.18;
    let ty = segStartY + Math.max(0, (h - chars.length * ch) / 2);
    for (const c of chars) { doc.text(c, x, ty, { width: widths[0], align: "center" }); ty += ch; }
  };
  drawHeader();
  segStartY = y;
  let prevKey = "";
  for (const r of rows) {
    // 동적 행 높이: 가장 긴 셀 기준(구분 제외)
    let needed = minRowH;
    if (!mergedLabel) {
      // 구분 세로 라벨(사전훈련/현장훈련)이 셀 밖으로 나가지 않도록 최소 높이 보장.
      // (페이지 넘김 직후엔 〃 자리도 전체 라벨을 다시 그리므로 모든 행에 적용)
      needed = Math.max(needed, [...r.sectionLabel].length * size * 1.18 + 4);
    }
    r.cells.forEach((c, i) => {
      const w = widths[i + 1] - 4;
      doc.font("KR").fontSize(size);
      const h = doc.heightOfString(c || "", { width: w, align: r.lefts?.[i] ? "left" : "center" }) + 10;
      if (h > needed) needed = h;
    });
    if (y + needed > pageBottom(doc)) {
      drawMerged(y);  // 현재 페이지 구분 라벨 마감
      doc.addPage(); y = doc.page.margins.top; drawHeader(); segStartY = y; prevKey = "";
    }
    // 구분 열
    if (mergedLabel) {
      // 빈 셀(테두리 없음 — 마지막에 병합 박스 1개로 그림)
    } else {
      const same = r.sectionKey === prevKey && prevKey !== "";
      if (same) cell(doc, x, y, widths[0], needed, "〃", { size });
      else cell(doc, x, y, widths[0], needed, r.sectionLabel, { vertical: true, size });
    }
    prevKey = r.sectionKey;
    // 나머지 7열
    let cx = x + widths[0];
    r.cells.forEach((c, i) => { cell(doc, cx, y, widths[i + 1], needed, c, { align: r.lefts?.[i] ? "left" : "center", size }); cx += widths[i + 1]; });
    y += needed;
  }
  drawMerged(y);
  return y;
}

// ── 2) 훈련일지 / 3) 적응지도 일지 ────────────────────────────
function dailyLog(kind: "TRAINING" | "ADAPTATION", p: any): Promise<Buffer> {
  const marginMm = 24; // 원본 좌우 여백 ≈ 24mm (내용폭 ≈162mm)
  const doc = newDoc(marginMm);
  const x = mm(marginMm), W = doc.page.width - mm(marginMm * 2);
  const isAdapt = kind === "ADAPTATION";

  if (isAdapt) {
    doc.font("KR").fontSize(7.5).fillColor("#000").text("[붙임24] 직무지도원을 활용한 취업 후 적응지도 일지", x, mm(11));
  }
  let y = title(doc, isAdapt ? "직무지도원을 활용한 취업 후 적응지도 일지" : "지원고용 훈련일지", isAdapt ? mm(18) : mm(14), isAdapt ? 14 : 16, { x, w: W, gap: mm(4) });

  // ── 메타 ──
  if (isAdapt) {
    // 3열: 근로자명 / 사업체명 / 적응지도기간. 사업체명(c2) > 적응지도기간(c3). 사업체명 중앙 = 하단 근무시간 우측경계.
    const c1 = W * 0.15, c2 = W * 0.47, c3 = W - c1 - c2;
    const hh = 18;
    cell(doc, x, y, c1, hh, "근로자명", { bold: true, size: 9, fill: "#d9d9d9" });
    cell(doc, x + c1, y, c2, hh, "사업체명", { bold: true, size: 9, fill: "#d9d9d9" });
    cell(doc, x + c1 + c2, y, c3, hh, "적응지도기간", { bold: true, size: 9, fill: "#d9d9d9" });
    y += hh;
    // 지도일수 = 실제 작성된 일지 수(표에 보이는 행 수와 동일).
    const wd = p.workingDays != null ? p.workingDays : ((Array.isArray(p.entries) ? p.entries.length : 0) || null);
    const days = wd != null ? ` (${wd})일` : "";
    cell(doc, x, y, c1, 24, p.traineeName ?? "", { size: 9 });
    cell(doc, x + c1, y, c2, 24, p.companyName ?? "", { size: 9 });
    cell(doc, x + c1 + c2, y, c3, 24, `${dot(p.periodStart) || ""} ~ ${dot(p.periodEnd) || ""}${days}`, { size: 8.5 });
    y += 24;
  } else {
    // 3열: 훈련생명 / 사업체명 / 훈련기간(사전·현장 2행) — 헤더행(음영) + 값행
    // 훈련생명|사업체명 경계 = 하단 훈련시간 헤더 "훈" 글자 위치(c1=0.23). 사업체명 +40%(c2), 훈련기간(c3) 축소.
    const c1 = W * 0.23, c2 = W * 0.372, c3 = W - c1 - c2;
    const hh = 18;
    cell(doc, x, y, c1, hh, "훈련생명", { bold: true, size: 9, fill: "#d9d9d9" });
    cell(doc, x + c1, y, c2, hh, "사업체명", { bold: true, size: 9, fill: "#d9d9d9" });
    cell(doc, x + c1 + c2, y, c3, hh, "훈 련 기 간", { bold: true, size: 9, fill: "#d9d9d9" });
    y += hh;
    const vh = 32;
    cell(doc, x, y, c1, vh, p.traineeName ?? "", { size: 9 });
    cell(doc, x + c1, y, c2, vh, p.companyName ?? "", { size: 9 });
    // 훈련기간 칸: 사전/현장 2행
    const sub = 28; // 라벨 칸 폭
    cell(doc, x + c1 + c2, y, sub, vh / 2, "사전", { size: 8.5 });
    cell(doc, x + c1 + c2 + sub, y, c3 - sub, vh / 2, p.periodPreText ?? "", { align: "left", size: 8.5 });
    cell(doc, x + c1 + c2, y + vh / 2, sub, vh / 2, "현장", { size: 8.5 });
    cell(doc, x + c1 + c2 + sub, y + vh / 2, c3 - sub, vh / 2, p.periodFieldText ?? "", { align: "left", size: 8.5 });
    y += vh;
  }
  y += 12;

  // ── 본문 ──
  const s = p.signatures ?? {};
  if (isAdapt) {
    const entries: any[] = Array.isArray(p.entries) ? p.entries : [];
    // 원본 정렬: 근무시간 우측경계=사업체명 중앙(0.385), 수행과제 우측≈사업체명 우측보다 약간 우측(0.63), 지도사항 -20%(0.278). 근무시간 +30%·1줄.
    const r0 = [0.043, 0.072, 0.106, 0.164, 0.098, 0.147, 0.092, 0.278];
    const widths = r0.map((f) => W * f);
    // 근무시간 헤더는 원본처럼 1줄. 출퇴근만 4줄.
    const headers = ["구\n분", "지도\n일자", "출석/결석/\n지각/조퇴", "근무시간", "출퇴근\n지도 및\n휴게시간\n지도 여부", "수행과제", "수행정도\n(측정시간)", "지도사항"];
    const TIME_TPL = "  :      ~      :  ";  // 근무시간 미지정 시 입력 양식(원본)

    // 행 = 실제 작성된 일지(엔트리)만. 출근일인데 일지 없는 날(빈 행)은 만들지 않음.
    // 근무시간·측정시간·Y/N 등 고정값은 생성 라우트가 근무형태로 계산해 엔트리에 담아줌.
    const mkRow = (dateText: string, e: any): DailyRow => ({
      sectionKey: "ADAPT",
      sectionLabel: "적응지도",
      cells: [
        dateText,
        String(e.attendance ?? ""),
        e.workTime ? String(e.workTime) : TIME_TPL,
        String(e.guidance ?? ""),
        String(e.task ?? ""),
        `${e.performanceLabel ?? ""}${e.performanceTime ? `\n(${e.performanceTime})` : ""}`,
        String(e.coaching ?? ""),
      ],
      lefts: [false, false, false, false, true, false, true],
    });
    const source: DailyRow[] = (entries.length ? entries : [{}]).map((e) =>
      mkRow(String(e.dateMD ?? (e.dateISO ? mdSlash(normYmd(e.dateISO)) : "")), e));

    y = dailyLogTable(doc, x, y, widths, headers, source, { size: 9, headerSize: 7.5, headerH: 52, headerLineGap: 0, minRowH: 36, mergedLabel: "적응지도" });
    // 특이사항 행 (세로 라벨 + 내용 span) — 내용 길이에 따라 높이 확장
    doc.font("KR").fontSize(9);
    const ihh = Math.max(42, doc.heightOfString(p.issues ?? "", { width: W - widths[0] - 4, align: "left" }) + 12);
    // 특이사항이 페이지 하단을 넘으면 다음 페이지로(셀 흩어짐 방지)
    if (y + ihh > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    cell(doc, x, y, widths[0], ihh, "특이사항", { vertical: true, bold: true, size: 8 });
    cell(doc, x + widths[0], y, W - widths[0], ihh, p.issues ?? "", { align: "left", size: 9 });
    y += ihh + 18;
    signatures(doc, y, [{ label: "직무지도원", sig: s.worker }, { label: "위탁기관 담당자", sig: s.govAgent }], { left: x, right: x + W });
  } else {
    const rowsData: any[] = Array.isArray(p.rows) ? p.rows : [];
    // 원본 비율(상·하단 정렬): 누적 0.279=훈련시간|지도여부(=훈련생명|사업체명), 수행정도[0.47,0.62]가 T2(0.545) 가로지름, 평가 0.38(원본 수준).
    // 훈련일자 축소(연/월일만), 출결 +슬래시 수용, 수행과제 넓힘, 평가 그만큼 축소.
    const r0 = [0.04, 0.072, 0.108, 0.052, 0.05, 0.22, 0.15, 0.308];
    const widths = r0.map((f) => W * f);
    // 헤더 폰트 9pt(상단과 동일). 지도여부는 2글자씩 줄바꿈(줄간격 음수로 셀밖 방지).
    const headers = ["구\n분", "훈련\n일자", "출석/결석/\n지각/조퇴", "훈련\n시간", "출퇴\n근\n지도\n및\n휴게\n시간\n지도\n여부", "수행과제", "수행정도\n(측정시간)", "평가 및 지도사항"];

    // 행 = 실제 작성된 일지만(빈 행 없음). 구분(사전/현장훈련)·시간·Y/N·측정시간은
    // 생성 라우트가 근무형태로 계산해 행에 담아줌.
    const source: DailyRow[] = (rowsData.length ? rowsData : [{}]).map((r) => ({
      sectionKey: r.section === "PRE" ? "PRE" : "FIELD",
      sectionLabel: r.section === "PRE" ? "사전훈련" : "현장훈련",
      cells: [
        r.date ? fmtTrainingDate(normYmd(r.date)) : "",
        String(r.attendanceStatus ?? ""),
        String(r.trainingTime ?? ""),
        String(r.guidanceFlag ?? ""),
        String(r.task ?? ""),
        String(r.taskLevelMeasured ?? ""),
        String(r.evalGuidance ?? ""),
      ],
      lefts: [false, false, false, false, true, false, true],
    }));
    y = dailyLogTable(doc, x, y, widths, headers, source, { size: 9, headerSize: 9, headerH: 92, headerLineGap: -1.5, minRowH: 40 });
    y += 18;
    // (서명)은 우측 끝에 붙이지 않고 여백을 둬 실제 서명 공간 확보
    signatures(doc, y, [
      { label: "(공단/위탁기관) 담당자", sig: s.govAgent },
      { label: "사업체담당자", sig: s.companyManager },
      { label: "직무지도원", sig: s.worker },
    ], { tail: "(서 명)", left: x, right: x + W - mm(10) });
  }
  return toBuffer(doc);
}

// ── 4) 5) 종합 평가기록부 (공통) ──────────────────────────────
const EVAL_MASTER = [
  { code: "WORK_ATTITUDE", label: "근무태도", items: ["결근, 지각, 조퇴 등을 하지 않는다", "결근, 지각, 조퇴 등을 할 때는 연락을 취한다", "휴식시간과 근무시간을 잘 지킨다", "주의사항을 잘 듣고 그대로 이행한다", "외모를 깨끗하고 단정하게 유지한다"] },
  { code: "INTERPERSONAL", label: "대인관계", items: ["상황에 맞는 적절한 경어를 사용한다", "주위동료와 협조를 잘한다", "상사, 동료, 고객에게 인사를 잘한다", "질문에 적절한 답변을 할 수 있다", "다른 사람의 이야기를 잘 청취한다."] },
  { code: "WORK_STYLE", label: "작업태도", items: ["적극적으로 업무에 참여한다", "지시 없이 스스로 자신의 일을 수행한다", "열심히 작업에 몰두한다", "목표량을 완수하면 다른 일거리를 찾는다", "잘못을 지적할 때 호의적으로 반응한다"] },
  { code: "WORK_PERFORMANCE", label: "작업수행", items: ["도구나 기계를 잘 다룬다.", "지시한 방법대로 작업을 수행한다(정확성)", "근무시간동안 산만하지 않고, 꾸준히 일한다.", "주어진 작업량을 완수한다.", "직무를 수행할수록, 속도와 정확성이 증가한다.(숙련성)"] },
];

function finalEval(kind: "TRAINEE" | "ADAPTATION", p: any): Promise<Buffer> {
  const marginMm = 24;
  const doc = newDoc(marginMm);
  const x = mm(marginMm), W = doc.page.width - mm(marginMm * 2);
  const isTrainee = kind === "TRAINEE";

  if (!isTrainee) {
    doc.font("KR").fontSize(7.5).fillColor("#000").text("[붙임25] 직무지도원을 활용한 취업 후 적응지도 종합 평가기록부", x, mm(11));
  }
  // 제목: 원본처럼 상단 여백 충분히 확보(1페이지 수용 위해 과하지 않게)
  let y = title(doc, isTrainee ? "지원고용 훈련생 종합 평가기록부" : "직무지도원을 활용한 적응지도 대상자 종합 평가기록부",
    isTrainee ? mm(30) : mm(28), isTrainee ? 16 : 14, { x, w: W, gap: mm(6) });

  // ── 공통 컬럼 기하 (상·하단 정렬) ──
  // 평가소견 왼쪽 = 훈련기간 왼쪽 = B. 항목칸은 최장 평가항목이 9pt 한 줄에 들어가도록 폭 산정 → B 역산.
  // (항목칸이 넓어진 만큼 평가소견=훈련기간(둘 다 W-B)이 같이 줄어 정렬 유지)
  const A = W * 0.25;      // 훈련생명 | 사업체명 경계
  const gw = W * 0.045;    // 구분 세로 라벨 폭
  const sw = W * 0.06;     // 사전/현장 점수칸 폭
  const slw = W * 0.04;    // 훈련기간 사전/현장 세로 라벨 폭
  doc.font("KR").fontSize(9);
  let maxItemW = 0;
  for (const sec of EVAL_MASTER) for (const it of sec.items) maxItemW = Math.max(maxItemW, doc.widthOfString(it));
  // 항목칸 = 최장 항목 + 좌우여유(좌측 pad 3 포함). B = 구분+항목+사전+현장. 평가소견/훈련기간 최소폭 위해 상한.
  const B = Math.min(W * 0.68, gw + (maxItemW + 12) + sw * 2);

  // ── 상단 박스(메타) ── 헤더행 + 값행
  const mhH = 18;
  cell(doc, x, y, A, mhH, isTrainee ? "훈련생명" : "대상자명", { bold: true, size: 9 });
  cell(doc, x + A, y, B - A, mhH, "사업체명", { bold: true, size: 9 });
  cell(doc, x + B, y, W - B, mhH, isTrainee ? "훈련기간" : "적응지도 기간", { bold: true, size: 9 });
  y += mhH;

  if (isTrainee) {
    // 훈련기간: 사전/현장 세로 라벨 + 값(2행). 훈련생명/사업체명 값은 2행 span.
    const subH = 22, valH = subH * 2;
    cell(doc, x, y, A, valH, p.traineeName ?? "", { size: 9 });
    cell(doc, x + A, y, B - A, valH, p.companyName ?? "", { size: 9 });
    cell(doc, x + B, y, slw, subH, "사전", { vertical: true, size: 8.5 });
    cell(doc, x + B + slw, y, W - B - slw, subH, rangeDot(p.preTrainingStart, p.preTrainingEnd), { align: "left", size: 8.5 });
    cell(doc, x + B, y + subH, slw, subH, "현장", { vertical: true, size: 8.5 });
    cell(doc, x + B + slw, y + subH, W - B - slw, subH, rangeDot(p.fieldTrainingStart, p.fieldTrainingEnd), { align: "left", size: 8.5 });
    y += valH;
  } else {
    const valH = 36;
    cell(doc, x, y, A, valH, p.traineeName ?? "", { size: 9 });
    cell(doc, x + A, y, B - A, valH, p.companyName ?? "", { size: 9 });
    const wd = countWeekdays(normYmd(p.periodStart), normYmd(p.periodEnd));
    const days = wd != null ? ` (${wd})일` : "";
    cell(doc, x + B, y, W - B, valH, `${dot(p.periodStart)} ~ ${dot(p.periodEnd)}${days}`, { size: 8.5 });
    y += valH;
  }

  // ── 하단 박스(평가표) — 상단과 연속(간격 없음) ──
  // 정렬: 평가소견 왼쪽 경계 = 훈련기간 왼쪽 경계(B). 사전/현장 점수칸은 B 왼쪽(=현장 오른쪽 경계가 B).
  const scores = p.scores ?? {};
  const comments = p.comments ?? {};
  const itemsW = B - sw * 2 - gw;  // 평가항목 텍스트 칸
  const seeW = W - B;              // 평가소견 칸(= 훈련기간 폭과 동일)
  const xPre = x + gw + itemsW;    // 사전 점수칸 x (= x+B-2sw)
  const xFin = xPre + sw;          // 현장 점수칸 x (= x+B-sw, 오른쪽 경계 = x+B)
  const xSee = x + B;              // 평가소견 x
  // 헤더행: "구 분"(구분+항목 병합) | 사전 | 현장 | 평 가 소 견 — 높이 축소(원본 수준)
  const hh = 16;
  cell(doc, x, y, gw + itemsW, hh, "구  분", { bold: true, size: 9 });
  cell(doc, xPre, y, sw, hh, isTrainee ? "사전" : "초기", { bold: true, size: 8.5 });
  cell(doc, xFin, y, sw, hh, isTrainee ? "현장" : "후기", { bold: true, size: 8.5 });
  cell(doc, xSee, y, seeW, hh, "평 가 소 견", { bold: true, size: 9 });
  y += hh;

  const rowH = 22;             // 균일 행 높이(원본처럼)
  let totalI = 0, totalF = 0;
  for (const sec of EVAL_MASTER) {
    const arr: any[] = Array.isArray(scores[sec.code]) ? scores[sec.code] : [];
    const secH = rowH * sec.items.length;
    // 구분(세로) + 소견 박스(섹션 span)
    cell(doc, x, y, gw, secH, sec.label, { vertical: true, bold: true, size: 9 });
    cell(doc, xSee, y, seeW, secH, comments[sec.code] ?? "", { align: "left", size: 9 });
    let ry = y;
    sec.items.forEach((text, i) => {
      const s = arr[i] ?? {};
      const ini = s.initial ?? "";
      const fin = s.final ?? "";
      if (!isNaN(Number(ini)) && ini !== "") totalI += Number(ini);
      if (!isNaN(Number(fin)) && fin !== "") totalF += Number(fin);
      // 기본 9pt, 한 줄에 안 들어가면 원본처럼 그 항목만 축소
      let fs = 9;
      doc.font("KR");
      while (fs > 6.5 && doc.fontSize(fs).widthOfString(text) > itemsW - 8) fs -= 0.5;
      cell(doc, x + gw, ry, itemsW, rowH, text, { align: "left", size: fs, pad: 3 });
      cell(doc, xPre, ry, sw, rowH, ini, { size: 9 });
      cell(doc, xFin, ry, sw, rowH, fin, { size: 9 });
      ry += rowH;
    });
    y += secH;
  }
  // 총점
  cell(doc, x, y, gw + itemsW, hh, "총 점(만점 100점)", { bold: true, size: 9 });
  cell(doc, xPre, y, sw, hh, String(totalI), { bold: true, size: 9 });
  cell(doc, xFin, y, sw, hh, String(totalF), { bold: true, size: 9 });
  cell(doc, xSee, y, seeW, hh, "", {});
  y += hh;
  // 비고 — 라벨 셀은 구분칸보다 넓게(원본)
  const bgH = 18, bgW = mm(13);
  cell(doc, x, y, bgW, bgH, "비고", { bold: true, size: 8.5 });
  cell(doc, x + bgW, y, W - bgW, bgH, "※ 항목별 점수채점 : 우수 5점, 양호 4점, 보통 3점, 미흡 2점, 불량 1점", { align: "left", size: 8 });
  y += bgH + mm(7);

  const s = p.signatures ?? {};
  // 서명 문구: 훈련생=「(서 명)」, 적응지도=「(서명 또는 인)」. 우측 여백(적응지도는 더 작게=오른쪽으로).
  signatures(doc, y, [{ label: "직무지도원", sig: s.worker }, { label: "(위탁기관) 담당자", sig: s.agencyAgent }],
    { tail: isTrainee ? "(서 명)" : "(서명 또는 인)", left: x, right: x + W - (isTrainee ? mm(15) : mm(6)) });
  return toBuffer(doc);
}

function dot(v?: string): string {
  if (!v) return "";
  return String(v).replace(/-/g, ".");
}
function rangeDot(a?: string, b?: string): string {
  const aa = dot(a), bb = dot(b);
  if (aa && bb) return `${aa}~${bb}`;
  return aa || bb;
}

// ── 급여명세서(임금명세서) ── 샘플 양식(기본사항|지급내역|공제내역|비고 4열 그리드)
// payload: { agencyName, workerName, workerBirth?, yearMonth, payDate?,
//   job, placementType, placementDate, totalHours,
//   payRows:[{name,hours?,amount,method?}], deductRows:[{name,amount}],
//   grossPay, totalDeduction, netPay }
function payslip(p: any): Promise<Buffer> {
  const doc = newDoc(14);
  const x = mm(14), W = doc.page.width - mm(28);
  const won = (n: any) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`;
  const payRows: { name: string; hours?: number; amount: number; method?: string }[] = Array.isArray(p.payRows) ? p.payRows : [];
  const deductRows: { name: string; amount: number }[] = Array.isArray(p.deductRows) ? p.deductRows : [];

  // 컬럼 폭
  const aW = W * 0.22, bW = W * 0.34, cW = W * 0.20, dW = W - aW - bW - cW;
  const aL = aW * 0.42, aV = aW - aL;                       // 기본사항 label|value
  const bN = bW * 0.50, bH = bW * 0.20, bA = bW - bN - bH;  // 지급내역 항목|시간|금액
  const cN = cW * 0.55, cA = cW - cN;                       // 공제내역 항목|금액
  const xA = x, xB = x + aW, xC = x + aW + bW, xD = x + aW + bW + cW;

  // ── 제목 + 지급일 ──
  let y = mm(12);
  const h0 = mm(11);
  cell(doc, x, y, aW + bW, h0, "급 여 명 세 서", { bold: true, size: 16 });
  cell(doc, xC, y, cW, h0, "지급일", { bold: true, size: 10, fill: "#efefef" });
  cell(doc, xD, y, dW, h0, p.payDate ?? "", { size: 10 });
  y += h0;

  // ── 헤더 밴드 ──
  const hh = mm(7);
  cell(doc, xA, y, aW, hh, "기본사항", { bold: true, size: 10, fill: "#e9eef5" });
  cell(doc, xB, y, bW, hh, "지급내역", { bold: true, size: 10, fill: "#e9eef5" });
  cell(doc, xC, y, cW, hh, "공제내역", { bold: true, size: 10, fill: "#e9eef5" });
  cell(doc, xD, y, dW, hh, "비고", { bold: true, size: 10, fill: "#e9eef5" });
  y += hh;

  // ── 서브헤더(지급내역만 3분할) ──
  const sh = mm(6);
  cell(doc, xA, y, aW, sh, "", { fill: "#f6f6f6" });
  cell(doc, xB, y, bN, sh, "임금항목", { bold: true, size: 8.5, fill: "#f6f6f6" });
  cell(doc, xB + bN, y, bH, sh, "시간", { bold: true, size: 8.5, fill: "#f6f6f6" });
  cell(doc, xB + bN + bH, y, bA, sh, "금액(원)", { bold: true, size: 8.5, fill: "#f6f6f6" });
  cell(doc, xC, y, cN, sh, "항목", { bold: true, size: 8.5, fill: "#f6f6f6" });
  cell(doc, xC + cN, y, cA, sh, "금액(원)", { bold: true, size: 8.5, fill: "#f6f6f6" });
  cell(doc, xD, y, dW, sh, "", { fill: "#f6f6f6" });
  y += sh;

  // ── 본문(패널별 행) ──
  const basic: [string, string][] = [
    ["이 름", p.workerName ?? ""],
    ["생년월일", p.workerBirth ?? ""],
    ["업 무", p.job ?? "직무지도"],
    ["배치형태", p.placementType ?? ""],
    ["배치일", p.placementDate ?? ""],
  ];
  const rowH = mm(7.5);
  const bodyRows = Math.max(basic.length, payRows.length, deductRows.length);
  const bodyTop = y, bodyH = bodyRows * rowH;

  for (let i = 0; i < bodyRows; i++) {
    const ry = bodyTop + i * rowH;
    // 기본사항
    if (i < basic.length) {
      cell(doc, xA, ry, aL, rowH, basic[i][0], { size: 8.5, bold: true, fill: "#f4f4f4" });
      cell(doc, xA + aL, ry, aV, rowH, basic[i][1], { size: 9 });
    } else {
      cell(doc, xA, ry, aW, rowH, "");
    }
    // 지급내역
    if (i < payRows.length) {
      const r = payRows[i];
      cell(doc, xB, ry, bN, rowH, r.name, { size: 8.5, align: "left", pad: 4 });
      cell(doc, xB + bN, ry, bH, rowH, r.hours ? String(r.hours) : "0", { size: 8.5, align: "right" });
      cell(doc, xB + bN + bH, ry, bA, rowH, r.amount ? won(r.amount) : "-", { size: 8.5, align: "right" });
    } else {
      cell(doc, xB, ry, bW, rowH, "");
    }
    // 공제내역
    if (i < deductRows.length) {
      const r = deductRows[i];
      cell(doc, xC, ry, cN, rowH, r.name, { size: 8.5, align: "left", pad: 4 });
      cell(doc, xC + cN, ry, cA, rowH, r.amount ? won(r.amount) : "-", { size: 8.5, align: "right" });
    } else {
      cell(doc, xC, ry, cW, rowH, "");
    }
  }

  // ── 비고(본문 전체 높이 1셀) ──
  const notes: string[] = ["[지급내역]"];
  for (const r of payRows) if (r.method) notes.push(`○ ${r.name}: ${r.method}`);
  notes.push("", "[공제내역]", "○ 소득세: 근로소득 간이세액표", "○ 주민세: 소득세의 10%", "○ 4대보험: 연도별 요율 적용");
  if (Number(p.employerIndustrial) > 0) notes.push(`○ 산재보험: ${Math.round(Number(p.employerIndustrial)).toLocaleString("ko-KR")}원 (전액 사업주 부담, 급여 공제 아님)`);
  notes.push("", "※ 통상시급은 근로계약서에 따름");
  doc.lineWidth(0.6).rect(xD, bodyTop, dW, bodyH).stroke("#000");
  doc.font("KR").fontSize(7.5).fillColor("#000").text(notes.join("\n"), xD + 4, bodyTop + 4, { width: dW - 8, align: "left", lineGap: 1.5 });

  y = bodyTop + bodyH;

  // ── 합계 밴드(총시간/급여총액, 공제합계) ──
  const th = mm(8);
  cell(doc, xA, y, aW, th, "", { fill: "#f4f4f4" });
  cell(doc, xB, y, bN, th, "총시간/급여총액", { bold: true, size: 8.5, fill: "#f4f4f4" });
  cell(doc, xB + bN, y, bH, th, String(p.totalHours ?? 0), { bold: true, size: 8.5, align: "right", fill: "#f4f4f4" });
  cell(doc, xB + bN + bH, y, bA, th, won(p.grossPay), { bold: true, size: 9, align: "right", fill: "#f4f4f4" });
  cell(doc, xC, y, cN, th, "공제합계", { bold: true, size: 8.5, fill: "#f4f4f4" });
  cell(doc, xC + cN, y, cA, th, won(p.totalDeduction), { bold: true, size: 9, align: "right", fill: "#f4f4f4" });
  cell(doc, xD, y, dW, th, "", { fill: "#f4f4f4" });
  y += th;

  // ── 당월 지급액 ──
  const nh = mm(11);
  cell(doc, xA, y, aW + bN, nh, "당 월 지 급 액 (원)", { bold: true, size: 11, fill: "#dfe7f3" });
  cell(doc, xB + bN, y, bH + bA + cW, nh, won(p.netPay), { bold: true, size: 13, align: "right", fill: "#dfe7f3" });
  cell(doc, xD, y, dW, nh, "귀하의 노고에 감사드립니다.", { bold: true, size: 9 });
  y += nh;

  // ── 기관명 ──
  y += mm(8);
  doc.font("KR-Bold").fontSize(13).fillColor("#000").text(p.agencyName ?? "", x, y, { width: W, align: "center" });

  return toBuffer(doc);
}

// ── 근로계약서 (고용노동부 단시간근로자 표준근로계약서) ──────────
// payload: {
//   employerBizName, employerPhone, employerAddress, employerRepName,
//   workerName, workerPhone, workerAddress,
//   contractStartText, contractEndText,           // "YYYY년 M월 D일"
//   workLocation, jobDescription,
//   workStartTime, workEndTime, breakStartTime, breakEndTime,  // "HH:MM"
//   workDaysPerWeek, weeklyHoliday,
//   wageType('HOURLY'|'DAILY'|'MONTHLY'), wageAmount,
//   bonusExists, bonusAmount, extraPayExists, extraPayDesc,
//   overtimeRate, wagePayday, wagePayMethod('DIRECT'|'ACCOUNT'),
//   specialClauses:[{title,body}],
//   dateText,                                      // 작성일 "YYYY년 M월 D일"
//   signatures:{ employer:{imageUrl?}, worker:{imageUrl?} }
// }
function employmentContract(p: any): Promise<Buffer> {
  // 양식 분기: 기관 양식 전용 렌더러(성동07·북부06).
  if (p?.templateKey === "SEONGDONG_07") return employmentContract07(p);
  if (p?.templateKey === "NORTH_06") return employmentContract06(p);
  const doc = newDoc(20);
  const x = mm(20), W = mm(170);
  const won = (n: any) => (n == null || n === "" ? "" : `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`);
  const hm = (t?: string) => {
    if (!t) return "    시      분";
    const [h, m] = String(t).split(":");
    return `${h ?? "  "}시 ${m ?? "  "}분`;
  };

  // 제목 박스
  doc.font("Batang-Bold").fontSize(17).fillColor("#000");
  const tTxt = "단시간근로자 표준근로계약서";
  const tW = doc.widthOfString(tTxt);
  const boxW = tW + mm(16), boxH = mm(11);
  const boxX = x + (W - boxW) / 2;
  let y = mm(15);
  doc.lineWidth(1).rect(boxX, y, boxW, boxH).stroke("#000");
  doc.text(tTxt, boxX, y + (boxH - doc.heightOfString(tTxt)) / 2, { width: boxW, align: "center" });
  y += boxH + mm(8);

  // 본문 줄 렌더 헬퍼
  const line = (text: string, opts: { size?: number; bold?: boolean; indent?: number; gap?: number; lineGap?: number } = {}) => {
    const { size = 10.5, bold = false, indent = 0, gap = 4, lineGap = 3 } = opts;
    const lx = x + indent, lw = W - indent;
    doc.font(bold ? "KR-Bold" : "KR").fontSize(size).fillColor("#000");
    doc.text(text, lx, y, { width: lw, lineGap });
    y = y + doc.heightOfString(text, { width: lw, lineGap }) + gap;
  };

  // 도입부
  const emp = p.employerBizName || "_____________";
  const wkr = p.workerName || "__________";
  line(`${emp}(이하 "사업주"라 함)과(와) ${wkr}(이하 "근로자"라 함)은 다음과 같이 근로계약을 체결한다.`, { gap: 8 });

  // 1. 근로계약기간
  const startT = p.contractStartText || "      년    월    일";
  const endT = p.contractEndText || "      년    월    일";
  line(`1. 근로계약기간 : ${startT}부터 ${endT}까지`);
  line(`※ 근로계약기간을 정하지 않는 경우에는 "근로개시일"만 기재`, { size: 8.5, indent: mm(4), gap: 6 });

  // 2~3
  line(`2. 근 무 장 소 : ${p.workLocation || ""}`);
  line(`3. 업무의 내용 : ${p.jobDescription || ""}`);

  // 4. 소정근로시간
  const brk = (p.breakStartTime || p.breakEndTime)
    ? `${hm(p.breakStartTime)} ~ ${hm(p.breakEndTime)}`
    : "    시  분 ~   시  분";
  line(`4. 소정근로시간 : ${hm(p.workStartTime)}부터 ${hm(p.workEndTime)}까지 (휴게시간 : ${brk})`);

  // 5. 근무일/휴일
  const days = p.workDaysPerWeek != null ? `${p.workDaysPerWeek}` : "  ";
  const wh = p.weeklyHoliday || "  ";
  line(`5. 근무일/휴일 : 매주 ${days}일(또는 매일단위) 근무, 주휴일 매주 ${wh}요일`);

  // 6. 임금
  line(`6. 임 금`);
  const wtLabel: Record<string, string> = { HOURLY: "시간급", DAILY: "일급", MONTHLY: "월급" };
  const wtMark = (k: string) => (p.wageType === k ? "●" : "○");
  const amt = won(p.wageAmount);
  line(`- ${wtMark("HOURLY")}시간급  ${wtMark("DAILY")}일급  ${wtMark("MONTHLY")}월급 : ${amt ? amt + " 원" : "                원"} ${p.wageType ? `(${wtLabel[p.wageType]})` : "(해당사항에 ●표)"}`, { indent: mm(4) });
  line(`- 상여금 : ${p.bonusExists ? `있음 ( ● )  ${won(p.bonusAmount)} 원` : "있음 (   )            원,  없음 ( ● )"}`, { indent: mm(4) });
  line(`- 기타급여(제수당 등) : ${p.extraPayExists ? `있음 : ${p.extraPayDesc || ""}` : "있음 (   ) 내역별 기재,  없음 ( ● )"}`, { indent: mm(4) });
  line(`- 초과근로에 대한 가산임금률 : ${p.overtimeRate != null ? p.overtimeRate : "    "} %`, { indent: mm(4) });
  line(`- 임금지급일 : 매월 ${p.wagePayday || "    "} 일 (휴일의 경우는 전일 지급)`, { indent: mm(4) });
  const pm = p.wagePayMethod;
  line(`- 지급방법 : 근로자에게 직접지급 (${pm === "DIRECT" ? "●" : " "}),  근로자 명의 예금통장에 입금 (${pm === "ACCOUNT" ? "●" : " "})`, { indent: mm(4) });

  // 7~9
  line(`7. 연차유급휴가 : 통상근로자의 근로시간에 비례하여 연차유급휴가 부여`);
  line(`8. 근로계약서 교부`);
  line(`- "사업주"는 근로계약을 체결함과 동시에 본 계약서를 사본하여 "근로자"의 교부요구와 관계없이 "근로자"에게 교부함(근로기준법 제17조 이행)`, { indent: mm(4) });
  line(`9. 기 타`);
  line(`- 이 계약에 정함이 없는 사항은 근로기준법령에 의함`, { indent: mm(4), gap: 6 });

  // 특약사항
  const clauses: { title: string; body: string }[] = Array.isArray(p.specialClauses) ? p.specialClauses : [];
  if (clauses.length) {
    if (y + mm(20) > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    line(`10. 특약사항`, { bold: true, gap: 4 });
    clauses.forEach((c, i) => {
      if (y + mm(14) > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
      line(`${i + 1}) ${c.title}`, { indent: mm(4), bold: true, gap: 2, size: 10 });
      if (c.body) line(c.body, { indent: mm(8), size: 9.5, gap: 4 });
    });
  }

  // 작성일
  y += mm(4);
  if (y + mm(50) > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
  doc.font("KR").fontSize(11).fillColor("#000").text(p.dateText || "          년      월      일", x, y, { width: W, align: "center" });
  y += mm(12);

  // 서명 블록 (사업주 / 근로자)
  // "(서명)"은 실제 서명이 들어가는 행(대표자·성명)에만 두고, 서명 이미지는 그 "(서명)" 위에 겹쳐 그린다(일지 방식과 동일).
  const sig = p.signatures ?? {};
  const drawSignName = (label: string, value: string, sign?: { imageUrl?: string } | undefined) => {
    const labelTxt = `${label} : ${value || ""}`;
    const startX = x + mm(6);
    doc.font("KR").fontSize(10.5).fillColor("#000").text(labelTxt, startX, y, { width: W - mm(40) });
    if (sign) {
      const tail = "(서명)";
      // "(서명)"은 이름 바로 뒤(약간 여백)에 배치. 이름 폭을 측정해 그 다음에 둔다.
      const nameW = doc.widthOfString(labelTxt);
      const sx = startX + nameW + mm(7);
      doc.font("KR").fontSize(10.5).fillColor("#000").text(tail, sx, y);
      // 서명/직인 이미지: "(서명)" 텍스트 중앙에 겹쳐 그림
      if (sign.imageUrl && sign.imageUrl.startsWith("data:image")) {
        try {
          const img = Buffer.from(sign.imageUrl.split(",")[1], "base64");
          const tailW = doc.widthOfString(tail);
          const cx = sx + tailW / 2;
          // 직인은 정사각(정규화 400×400 PNG)으로 저장됨 → 정사각이면 직인으로 보고 실제 도장 크기(큰 정사각)로 그림.
          const meta = pngSize(img);
          const isStamp = !!meta && Math.abs(meta.w / meta.h - 1) < 0.12;
          if (isStamp) {
            const s = mm(20); // 직인 실제 크기(정사각)
            doc.image(img, cx - s / 2, y - mm(8), { fit: [s, s], align: "center", valign: "center" });
          } else {
            const imgW = mm(32.3), imgH = mm(13.3);
            doc.image(img, cx - imgW / 2, y - mm(4.5), { fit: [imgW, imgH], align: "center", valign: "center" });
          }
        } catch { /* 무시 */ }
      }
    }
    y += mm(7);
  };

  doc.font("KR-Bold").fontSize(10.5).fillColor("#000").text("(사업주)", x, y); y += mm(6.5);
  drawSignName("사 업 체 명", p.employerBizName + (p.employerPhone ? `      (전화 : ${p.employerPhone})` : ""));
  drawSignName("주        소", p.employerAddress);
  drawSignName("대  표  자", p.employerRepName, sig.employer);
  y += mm(3);
  doc.font("KR-Bold").fontSize(10.5).fillColor("#000").text("(근로자)", x, y); y += mm(6.5);
  drawSignName("주        소", p.workerAddress);
  drawSignName("연  락  처", p.workerPhone);
  drawSignName("성        명", p.workerName, sig.worker);

  return toBuffer(doc);
}

// ── 직무지도원 표준근로계약서 (기관 양식: 성동07·북부06 공용) ──────────
// 갑(기관) 정보는 사용 기관 데이터로 채움. cfg로 양식별 차이(시간표/듣고인지/을 라벨/지급일) 제어.
// templateData: { workerBirthDate, heardAndAcknowledged }
// ※ 조문 텍스트는 원본 양식 이미지 기준 — 최종 문구는 사용자 확인/교정 대상.
type InstContractCfg = { eulNameLabel: string; timeMode: "table" | "inline"; showHeard: boolean; defaultPayday: string };
function instContract(p: any, cfg: InstContractCfg): Promise<Buffer> {
  const doc = newDoc(20);
  const x = mm(20), W = mm(170);
  const won = (n: any) => (n == null || n === "" ? "______" : `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`);
  const td = p.templateData ?? {};

  const BODY = 10.5; // 본문 크기(자동 밑줄은 10pt↑에서 1pt 고정)
  const CS = 0.4;    // 본문 자간(07과 동일)
  let y = mm(22);  // 상단 여백 확대

  // 제목 — 원본과 동일 명조(Batang) 계열, 볼드 제거, 자간 넓게
  doc.font("Batang").fontSize(18).fillColor("#000").text("직무지도원 표준근로계약서", x, y, { width: W, align: "center", characterSpacing: 0.5 });
  y += mm(15);

  // 조항 사이·도입문 위아래 가로 구분선
  const divider = (gapBefore = mm(2.4), gapAfter = mm(2.4)) => {
    y += gapBefore;
    if (y > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    doc.moveTo(x, y).lineTo(x + W, y).lineWidth(0.5).strokeColor("#000").stroke();
    y += gapAfter;
  };

  // 데이터(밑줄) 세그먼트. {u:값} = 데이터 → 밑줄. 빈 값은 빈칸 밑줄.
  type Seg = string | { u: string } | { uw: string }; // u=데이터 밑줄(여유 패딩), uw=문장 전체 밑줄(패딩 없음)
  const D = (v: string | number | null | undefined): Seg => ({ u: (v == null || String(v) === "" ? "            " : String(v)) });

  // 문단 렌더(세그먼트). 데이터 세그먼트는 밑줄 + 값보다 여유 있게(뒤 공백) 표시. 서명부는 사용 안 함.
  const para = (segs: Seg[], opts: { indent?: number; gap?: number; size?: number; bold?: boolean; firstIndent?: number } = {}) => {
    const { indent = mm(3), gap = mm(1.6), size = BODY, bold = false, firstIndent = 0 } = opts;
    const lx = x + indent, lw = W - indent;
    const font = bold ? "Batang-Bold" : "Batang"; // 원본이 명조(바탕)체 → 전체 통일
    // 어절 내부 글자 사이에 Word Joiner(U+2060) 삽입 → 공백에서만 줄바꿈(한글 단어 잘림 방지)
    const WJ = String.fromCharCode(0x2060);
    const keep = (str: string) => str.replace(/(\S)(?=\S)/g, `$1${WJ}`);
    // "갑"·"을" 앞뒤 각각 한 칸 여백(기존 공백은 흡수해 두 칸 방지)
    const padParty = (str: string) => str.replace(/\s*"갑"\s*/g, ' "갑" ').replace(/\s*"을"\s*/g, ' "을" ');
    const text = (s: Seg): string => {
      if (typeof s === "string") return keep(padParty(s));
      if ("uw" in s) return keep(padParty(s.uw));   // 문장 전체 밑줄: 패딩 없음
      return `    ${keep(s.u)}    `;                  // 데이터 값: 앞뒤 4칸 → 밑줄이 값보다 넓게
    };
    const plain = segs.map(text).join("");
    doc.font(font).fontSize(size);
    const h = doc.heightOfString(plain, { width: lw, lineGap: 2, indent: firstIndent, characterSpacing: CS });
    if (y + h > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    const y0 = y;
    segs.forEach((s, i) => {
      // 자동 밑줄(위치 정확) — 굵기는 폰트<10이면 0.5pt
      const o: any = { width: lw, lineGap: 2, continued: i !== segs.length - 1, underline: typeof s !== "string", characterSpacing: CS };
      if (i === 0 && firstIndent) o.indent = firstIndent;
      doc.font(font).fontSize(size).fillColor("#000");
      if (i === 0) doc.text(text(s), lx, y0, o); else doc.text(text(s), o);
    });
    y = y0 + h + gap;
  };

  const art = (t: string) => para([t.replace("【", " 【")], { bold: true, indent: 0, gap: mm(1.2), size: 12.5 });
  const sub = (t: string, o: { indent?: number } = {}) => para([t], { indent: o.indent ?? mm(3) });

  const emp = p.employerBizName || "________________";
  const wkr = p.workerName || "________";

  divider(mm(3), mm(3));
  // 도입문 — 기관명·직무지도원명 밑줄
  para([D(emp), ` (이하 "갑"이라 한다)와 `, D(wkr), ` (이하 "을"이라 한다)는 다음과 같이 근로계약을 체결하고 상호 성실히 이행할 것을 약정한다.`], { indent: 0, gap: mm(0.5), firstIndent: mm(4) });
  divider(mm(3), mm(3));

  art("제1조【근로계약기간】");
  para([`① "을"의 근로계약기간은 `, D(p.contractStartText), ` ~ `, D(p.contractEndText), `까지로 한다.`]);
  sub(`② 근로계약 만료 시 또는 훈련생(취업자) 지원고용 현장훈련(취업 후 적응지도) 등 서비스가 종료된 경우 본 계약은 종료된 것으로 간주한다.`);
  divider();

  art("제2조【근로장소 및 직무】");
  para([`① "을"의 근로 장소는 `, D("장애인 훈련생(취업자)이 훈련(근무)하는 사업체"), `로 한다. 단, 업무상 필요한 경우 "갑"은 "을"과 협의하여 근로 장소를 변경할 수 있다.`]);
  para([`② "을"의 직무는 장애인 훈련생(취업자) 장애로 인하여 독자적인 현장훈련(적용)이 어려운 경우 직무지도원을 배치하여 안정적·지속적으로 지원하는 `, D("중증장애인 지원고용 직무지도"), `로 한다.`]);
  divider();

  art("제3조【임금】");
  sub(`① "을"의 임금은 지원고용 사업안내에 따라 시급제로 지급된다.`);
  para([`② `, { uw: `"을"의 시급은 당해 연도 최저시급(${won(p.wageAmount)}원)이며, 주휴수당은 별도로 지급한다.` }]);
  para([`③ `, { uw: `"을"이 훈련생(취업자)을 2인 이상 동시에 지원(직무지도)하는 경우 시급의 120%를 지급한다. 다만 지원고용 현장훈련(적응지도) 중 직무지도 훈련생의 변동이 있는 경우(1명 지도) 일할로 계산한다.` }]);
  sub(`④ 임금 외의 수당은 주휴수당 및 월차수당 지급한다.`);
  sub(`⑤ 임금지급일은 지원고용 현장훈련(취업 후 적응지도) 종료 후 14일 이내로 지급한다. 다만 훈련지도 일수가 1개월을 초과하는 경우 월단위로 지급할 수 있다.`);
  sub(`⑥ 지급일이 휴일인 경우 전일에 지급하며, 지급방법은 "을" 명의의 통장으로 입금한다.`);
  sub(`⑦ 월 실지급액은 사회보험료(국민연금, 건강보험, 고용보험)을 제외한다.`);
  // ⑦ 듣고 인지함 — 양식에 있을 때만(07). 체크 시 같은 줄 오른쪽에 표기 + 을 서명
  if (cfg.showHeard) {
    const yMark = y;
    sub(`⑦ "을"은 "갑"으로부터 위 임금 내용을 듣고 인지함.`);
    if (td.heardAndAcknowledged) {
      doc.font("Batang-Bold").fontSize(10).fillColor("#000").text("( 듣고 인지함 )", x + mm(72), yMark);
      const sig = p.signatures?.worker;
      if (sig?.imageUrl && String(sig.imageUrl).startsWith("data:image")) {
        try { doc.image(Buffer.from(sig.imageUrl.split(",")[1], "base64"), x + mm(112), yMark - mm(2.5), { fit: [mm(26), mm(10)] }); } catch { /* 무시 */ }
      }
    }
  }
  divider();

  art("제4조【근로시간 및 휴게시간】");
  if (cfg.timeMode === "table") {
    para([`① 근로일별 소정근로시간은 아래와 같고 `, D("지원고용 현장훈련(취업 후 적응지도)"), ` 서비스 차원의 시간으로 한다.`]);
    const toMin = (t?: string) => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
    const ws = toMin(p.workStartTime), we = toMin(p.workEndTime), bs = toMin(p.breakStartTime), be = toMin(p.breakEndTime);
    let workH = "";
    if (ws != null && we != null) { let mins = we - ws; if (bs != null && be != null) mins -= (be - bs); workH = (mins / 60).toFixed(1).replace(/\.0$/, ""); }
    const cols = [mm(48), mm(28), mm(28), mm(28), mm(38)];
    const head = ["근로일", "소정근로시간", "시업시간", "종업시간", "휴게시간"];
    const row = [
      `${p.contractStartText || ""} ~`, workH || "", p.workStartTime || "", p.workEndTime || "",
      (p.breakStartTime || p.breakEndTime) ? `${p.breakStartTime || ""}~${p.breakEndTime || ""}` : "",
    ];
    const rh = mm(7);
    if (y + rh * 2 > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    const drawRow = (vals: string[], bold: boolean) => {
      let cx = x;
      doc.font(bold ? "Batang-Bold" : "Batang").fontSize(9).fillColor("#000");
      cols.forEach((cw, i) => {
        doc.lineWidth(0.6).rect(cx, y, cw, rh).stroke("#000");
        doc.text(vals[i] ?? "", cx + mm(1), y + (rh - doc.heightOfString(vals[i] ?? "", { width: cw - mm(2) })) / 2, { width: cw - mm(2), align: "center" });
        cx += cw;
      });
      y += rh;
    };
    drawRow(head, true); drawRow(row, false);
    y += mm(2);
    sub(`② 휴게시간은 제1항의 표와 같되 업무특성을 고려하여 장애인 훈련생(취업자)의 휴게시간에 따라 분할하여 부여할 수 있다.`);
  } else {
    para([`① 소정근로시간은 `, D("1일 8시간, 주 40시간"), ` 이내에서 `, D("지원고용 현장훈련(취업 후 적응지도)"), ` 서비스 지원시간으로 한다.`]);
    sub(`② 휴게시간은 근로시간이 1일 4시간인 경우 30분 이상, 8시간인 경우에는 1시간 이상으로 하되, 업무특성을 고려하여 장애인근로자의 휴게시간에 따라 분할하여 부여할 수 있다.`);
  }
  divider();

  art("제5조【근무일과 휴일】");
  sub(`① "을"의 근무일은 장애인근로자의 근무일에 근로하고, 주휴일은 일주일 동안 소정 근로일을 개근한 경우 1일의 유급휴가를 부여한다.`);
  sub(`② 근로자의 날(5.1) 유급휴일로 부여한다.`);
  sub(`③ 휴일(공휴일)에 관한 사항은 근로기준법 제55조에 정한 바로 한다.`);
  sub(`④ "갑"은 "을"이 유급 또는 무급휴일에 근로한 경우에는 근로기준법에 따른 대체 휴무를 부여하거나, 수당을 지급한다.`);
  sub(`⑤ 연차유급휴가는 근로기준법에 따라 부여하며, 연차유급휴가 사용 시에는 장애인 훈련생(취업자)과 협의를 통하여 사용하여야 한다.`);
  sub(`⑥ 제1항과 제5항에도 불구하고 "을"의 소정근로시간이 주 15시간, 월 60시간 미만인 경우에는 주휴일과 연차유급휴가를 적용하지 아니한다.`);
  divider();

  art("제6조【의무】");
  sub(`① "을"은 지원고용 훈련일지 및 직무지도원 출근부를 매일 성실히 작성하여야 하며 "갑"에게 제출하여야 한다.`);
  sub(`② "을"은 "갑"에서 시행하는 교육 및 간담회에 참여하여야 한다.`);
  divider();

  art("제7조【복무】");
  sub(`① "을"은 업무수행 시 중대한 사항이 발생할 경우 "갑"에게 보고해야 한다.`);
  sub(`② "을"은 "갑"이 정한 취업규칙 및 운영규정을 준수하여야 한다.`);
  sub(`③ "을"은 장애인 훈련생(취업자)의 지원고용 현장훈련(취업 후 적응지도) 서비스 중단 등 중단 사유가 발생할 경우 지체 없이 "갑"에서 알려야 한다.`);
  sub(`④ "을"은 장애인 훈련생(취업자) 또는 사업장에서 부당한 행위를 당한 경우 즉시 "갑"에게 그 사실을 통지하여야 하며, "갑"은 "을"이 부당한 행위를 당하지 않도록 조치하여야 한다.`);
  sub(`⑤ 제4항의 조치사항 이행 시 "갑"은 "을"에게 불합리한 처우를 해서는 안 된다. 단, "을"에게 귀책사유가 있는 경우는 제외한다.`);
  divider();

  art("제8조【비밀유지】");
  sub(`① "갑"은 장애인 훈련생(취업자)의 개인정보를 목적 외에 다른 용도로 사용하거나 다른 사람 또는 기관에 제공하여서는 안 된다.`);
  sub(`② "을"은 업무수행 시 발생되는 사업장의 정보 및 장애인 훈련생(취업자)의 개인정보에 대해 타인에게 누설하여서는 안 되며, 이를 위반하는 경우 모든 책임은 "을"이 진다.`);
  divider();

  art("제9조【재해보상】");
  sub(`"을"이 업무상 재해를 당하였을 경우 산업재해보상보험법에 의거하여 보상한다.`);
  divider();

  art("제10조【배상】");
  sub(`"을"은 다음 각 호에 해당하는 경우에는 "갑"에게 배상하여야 한다.`);
  sub(`1. 거짓 또는 그 밖에 부정한 방법으로 임금을 받았을 경우`, { indent: mm(6) });
  sub(`2. 지원고용사업이 사업취지에 맞지 않게 활동하는 경우`, { indent: mm(6) });
  divider();

  art("제11조【계약해지 및 해고】");
  sub(`① "갑"은 다음 각 호에 해당하는 경우에는 계약 만료전이라도 "을"의 계약을 해지할 수 있다.`);
  sub(`1. "갑"이 지원고용(직무지도원 관리) 사업을 중단하였을 경우`, { indent: mm(6) });
  sub(`2. 장애인 훈련생(취업자)가 "을"의 근무를 거부하거나, 장애인 훈련생(취업자)의 현장훈련(적응지도)이 종료된 경우`, { indent: mm(6) });
  sub(`3. 장애인근로자가 속한 사업주에게 근로를 제공하는 등 직무지도원의 의무를 성실히 수행하지 않을 경우`, { indent: mm(6) });
  sub(`4. "을"이 지각, 조퇴, 음주, 근무지 이탈, 위탁기관의 지시 불응 등 근무태도가 불성실한 경우`, { indent: mm(6) });
  sub(`5. 신체 정신상의 이유로 업무수행이 곤란한 경우`, { indent: mm(6) });
  sub(`② "갑"은 "을"이 다음 각 호의 해당하는 경우 해고조치 할 수 있다.`);
  sub(`1. 제6조(의무)를 이행하지 않는 경우`, { indent: mm(6) });
  sub(`2. 제10조(배상)에 해당하는 경우`, { indent: mm(6) });
  sub(`3. "갑"이 지정하는 장애인 훈련생(취업자)와 특별한 사유 없이 3번 이상 근로를 거부한 경우`, { indent: mm(6) });
  sub(`4. 제반관련 규정을 위반하여 중대한 민원 및 "갑"에 손실을 입혔을 경우`, { indent: mm(6) });
  sub(`5. "갑"의 복무규정 등을 중대하게 위반한 경우`, { indent: mm(6) });
  divider();

  art("제12조【근로기준법의 적용】");
  sub(`본 계약서에 명시되지 않는 사항은 단체협약, 취업규칙 또는 근로기준법 등 관계법령이 정하는 바에 따른다.`);
  divider();

  art("제13조【근로계약서 교부】");
  sub(`① 본 계약은 "갑"와 "을"의 서명날인 즉시 그 효력이 발생하여 계약서를 날인한 후 각각 1부씩 보관한다.`);
  divider();

  // 작성일 + 갑/을 서명란이 한 페이지에 함께 들어가도록 충분한 잔여공간 확보(부족 시 새 페이지)
  if (y + mm(70) > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
  y += mm(2);
  doc.font("Batang").fontSize(12).fillColor("#000").text(p.dateText || "          년      월      일", x, y, { width: W, align: "center" });
  y += mm(9);
  divider(mm(0), mm(6)); // 날짜 밑 구분선

  // 갑/을 2열 서명란
  const colL = x, colR = x + mm(90);
  doc.font("Batang-Bold").fontSize(14).text("[ 갑 ]", colL, y, { width: mm(80), align: "center" });
  doc.text("[ 을 ]", colR, y, { width: mm(80), align: "center" });
  y += mm(11);

  const fmtBirth = (b?: string) => (b ? String(b).replace(/-/g, ".") : "");
  const drawImg = (url: string | undefined, ix: number, iy: number) => {
    if (!url || !String(url).startsWith("data:image")) return;
    try {
      const img = Buffer.from(url.split(",")[1], "base64");
      const meta = pngSize(img);
      const square = !!meta && Math.abs(meta.w / meta.h - 1) < 0.12;
      if (square) doc.image(img, ix, iy - mm(6), { fit: [mm(16), mm(16)] });
      else doc.image(img, ix, iy - mm(3), { fit: [mm(28), mm(11)] });
    } catch { /* 무시 */ }
  };
  const SF = 9.5; // 서명부 글자크기
  const rowL = (label: string, val: string) => { doc.font("Batang").fontSize(SF).fillColor("#000").text(`■ ${label} : ${val || ""}`, colL, y, { width: mm(85) }); };
  const rowR = (label: string, val: string) => { doc.font("Batang").fontSize(SF).fillColor("#000").text(`■ ${label} : ${val || ""}`, colR, y, { width: mm(80) }); };

  // 1행: 기관명 + (직인) | 직무지도원 + (서명/날인). 라벨·(표현)은 고정, 값(emp/wkr)·직인/서명 이미지는 계약 데이터.
  const stampRow = (label: string, val: string, tag: string, gapChars: number, colX: number, img?: string) => {
    doc.font("Batang").fontSize(SF).fillColor("#000");
    const base = `■ ${label} : ${val || ""}`;
    doc.text(base, colX, y, { lineBreak: false });
    const tagX = colX + doc.widthOfString(base) + doc.widthOfString(" ") * gapChars;
    doc.text(tag, tagX, y, { lineBreak: false });
    if (img) drawImg(img, tagX, y); // 실제 직인/서명을 (표현) 위치에 맞춰 배치
  };
  // 갑(3행)·을(4행) — 상단(기관명/직무지도원)·하단(소재지/주소) 양쪽 정렬. 갑은 행수가 적어 줄간격을 넓혀 같은 높이를 채움.
  const yTop = y;
  const S = mm(8);            // 을 행 간격
  const Lg = (3 * S) / 2;     // 갑 행 간격(3행이 을 4행 높이와 같도록)
  y = yTop;          stampRow("위탁기관명", emp, "(직인)", 2, colL, p.signatures?.employer?.imageUrl);
  y = yTop + Lg;     rowL("대  표  자", p.employerRepName || "");
  y = yTop + 2 * Lg; rowL("소  재  지", p.employerAddress || "");
  y = yTop;          stampRow(cfg.eulNameLabel, wkr, "(서명/날인)", 8, colR, p.signatures?.worker?.imageUrl);
  y = yTop + S;      rowR("생 년 월 일", fmtBirth(p.workerBirthDate ?? td.workerBirthDate));
  y = yTop + 2 * S;  rowR("연  락  처", p.workerPhone || "");
  y = yTop + 3 * S;  rowR("주        소", p.workerAddress || "");
  y = yTop + 3 * S + mm(8);

  return toBuffer(doc);
}
// ── 07 성동 전용(레거시) — 이번 세션 레이아웃 개편 전 원본 그대로. 06과 분리해 07은 미변경 유지. ──
function instContract07Legacy(p: any, cfg: InstContractCfg): Promise<Buffer> {
  const doc = newDoc(20);
  const x = mm(20), W = mm(170);
  const won = (n: any) => (n == null || n === "" ? "______" : `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`);
  const td = p.templateData ?? {};

  let y = mm(15);
  // 제목(박스 없음, 가운데)
  doc.font("Batang-Bold").fontSize(18).fillColor("#000").text("직무지도원 표준근로계약서", x, y, { width: W, align: "center" });
  y += mm(12);

  const line = (text: string, opts: { size?: number; bold?: boolean; indent?: number; gap?: number } = {}) => {
    const { size = 10, bold = false, indent = 0, gap = 3 } = opts;
    const lx = x + indent, lw = W - indent;
    if (y + doc.heightOfString(text, { width: lw, lineGap: 2 }) > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    doc.font(bold ? "KR-Bold" : "KR").fontSize(size).fillColor("#000").text(text, lx, y, { width: lw, lineGap: 2 });
    y = y + doc.heightOfString(text, { width: lw, lineGap: 2 }) + gap;
  };
  const art = (t: string) => line(t, { bold: true, size: 10.5, gap: 3 });
  const sub = (t: string, o: { indent?: number } = {}) => line(t, { indent: o.indent ?? mm(3), gap: 2 });

  const emp = p.employerBizName || "________________";
  const wkr = p.workerName || "________";

  line(`${emp} (이하 "갑"이라 한다)와(과) ${wkr} (이하 "을"이라 한다)는 다음과 같이 근로계약을 체결하고 상호 성실히 이행할 것을 약정한다.`, { gap: 8 });

  art("제1조【근로계약기간】");
  sub(`① "을"의 근로계약기간은 ${p.contractStartText || "____년 __월 __일"}부터 ~ ${p.contractEndText || "____년 __월 __일"}까지로 한다.`);
  sub(`② 근로계약 만료 시 또는 훈련생(취업자) 지원고용 현장훈련(취업 후 적응지도) 등 서비스가 종료된 경우 본 계약은 종료된 것으로 간주한다.`);

  art("제2조【근로 장소 및 직무】");
  sub(`① "을"의 근로 장소는 장애인 훈련생(취업자)이 훈련(근무)하는 ( ${p.workLocation || "____________"} )으로 한다. 단, 업무상 필요한 경우 "갑"은 "을"과 협의하여 근로 장소를 변경할 수 있다.`);
  sub(`② "을"의 직무는 장애인 훈련생(취업자)이 장애로 인하여 독자적인 현장훈련(직무수행)이 어려운 경우 직무지도를 매개하여 안정적·지속적으로 지원하는 중증장애인 지원고용 직무지도로 한다.`);

  art("제3조【임금】");
  sub(`① "을"의 시급은 해당 연도 최저시급(${won(p.wageAmount)}원)으로 하며, 주휴수당은 별도로 지급한다.`);
  sub(`② "을"이 장애인 훈련생(취업자)을 2인 이상 동시에 지원(직무지도)하는 경우 시급의 120%를 지급한다. 다만 지원고용 현장훈련(적응지도) 중 직무지도 훈련생의 변동이 있는 경우(1명 지도)는 해당 임금으로 계산한다.`);
  sub(`③ 별도 수당은 위탁기관 사정에 따라 지급할 수 있다.`);
  sub(`④ 임금은 매월 1일부터 말일까지 계산하여 익월 ${p.wagePayday || cfg.defaultPayday}일에 지급한다.`);
  sub(`⑤ 임금은 "을" 명의의 예금통장으로 입금한다.`);
  sub(`⑥ 월 실지급액은 사회보장료(국민연금, 건강보험, 고용보험)를 제외한 금액이다.`);
  // ⑦ 듣고 인지함 — 양식에 있을 때만(07). 체크 시 표기 + 을 서명
  if (cfg.showHeard) {
    const txt = `⑦ "을"은 "갑"으로부터 위 임금 내용을 듣고 인지함.`;
    line(txt, { indent: mm(3), gap: 2 });
    if (td.heardAndAcknowledged) {
      const mark = "( 듣고 인지함 )";
      doc.font("KR-Bold").fontSize(10).fillColor("#000").text(mark, x + mm(60), y - mm(5.5));
      const sig = p.signatures?.worker;
      if (sig?.imageUrl && String(sig.imageUrl).startsWith("data:image")) {
        try { doc.image(Buffer.from(sig.imageUrl.split(",")[1], "base64"), x + mm(100), y - mm(8), { fit: [mm(28), mm(11)] }); } catch { /* 무시 */ }
      }
    }
  }

  art("제4조【근로시간 및 휴게시간】");
  if (cfg.timeMode === "table") {
    sub(`① 근로일별 소정근로시간은 아래와 같고 지원고용 현장훈련(취업 후 적응지도) 서비스 차원의 시간으로 한다.`);
    const toMin = (t?: string) => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
    const ws = toMin(p.workStartTime), we = toMin(p.workEndTime), bs = toMin(p.breakStartTime), be = toMin(p.breakEndTime);
    let workH = "";
    if (ws != null && we != null) { let mins = we - ws; if (bs != null && be != null) mins -= (be - bs); workH = (mins / 60).toFixed(1).replace(/\.0$/, ""); }
    const cols = [mm(48), mm(28), mm(28), mm(28), mm(38)];
    const head = ["근로일", "소정근로시간", "시업시간", "종업시간", "휴게시간"];
    const row = [
      `${p.contractStartText || ""} ~`, workH || "", p.workStartTime || "", p.workEndTime || "",
      (p.breakStartTime || p.breakEndTime) ? `${p.breakStartTime || ""}~${p.breakEndTime || ""}` : "",
    ];
    const rh = mm(7);
    if (y + rh * 2 > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    const drawRow = (vals: string[], bold: boolean) => {
      let cx = x;
      doc.font(bold ? "KR-Bold" : "KR").fontSize(9).fillColor("#000");
      cols.forEach((cw, i) => {
        doc.lineWidth(0.6).rect(cx, y, cw, rh).stroke("#000");
        doc.text(vals[i] ?? "", cx + mm(1), y + (rh - doc.heightOfString(vals[i] ?? "", { width: cw - mm(2) })) / 2, { width: cw - mm(2), align: "center" });
        cx += cw;
      });
      y += rh;
    };
    drawRow(head, true); drawRow(row, false);
    y += mm(2);
    sub(`② 휴게시간은 제1항의 표와 같되 업무특성을 고려하여 장애인 훈련생(취업자)의 휴게시간에 따라 분할하여 부여할 수 있다.`);
  } else {
    const note = (p.workStartTime && p.workEndTime)
      ? ` (시업 ${p.workStartTime} ~ 종업 ${p.workEndTime}${(p.breakStartTime || p.breakEndTime) ? `, 휴게 ${p.breakStartTime || ""}~${p.breakEndTime || ""}` : ""})`
      : "";
    sub(`① 소정근로시간은 1일 8시간, 주 40시간 이내에서 지원고용 현장훈련(취업 후 적응지도) 서비스 차원으로 한다.${note}`);
    sub(`② 휴게시간은 근로시간이 4시간인 경우 30분 이상, 8시간인 경우 1시간 이상을 근로시간 도중에 부여한다.`);
  }

  art("제5조【근무일과 휴일】");
  sub(`① "을"은 장애인 훈련생(취업자)의 근무일에 근로하고, 주휴일은 1주간 소정근로일을 개근한 경우 1일의 유급휴일을 부여한다.`);
  sub(`② 휴일·휴가 등 본 계약에 정하지 않은 사항은 근로기준법령 및 "갑"의 취업규칙에 따른다.`);

  art("제6조【의무】");
  sub(`① "을"은 직무지도 훈련일지 및 직무지도원 출근부를 매월 성실히 작성하여 "갑"에게 제출하여야 한다.`);

  art("제7조【복무】");
  sub(`① "을"은 업무수행 시 준수할 사항이 발생할 경우 "갑"에게 보고하여 한다.`);
  sub(`② "을"은 "갑"이 정한 ${emp} 취업규칙 및 제반 규정을 준수하여야 한다.`);
  sub(`③ "을"은 장애인 훈련생(취업자)의 직무 적응 현장훈련(취업 후 적응지도) 서비스 중 알게 된 정보를 누설하여서는 아니 된다.`);
  sub(`④ "을"은 업무 외 사적으로 훈련생(취업자)과 부당한 행위를 하여서는 아니 된다.`);

  art("제8조【비밀유지】");
  sub(`① "을"은 장애인 훈련생(취업자)의 개인정보를 본래 용도로 사용하며, 다른 사람·기관에 제공하여서는 아니 된다.`);
  sub(`② "을"은 업무수행 시 발생하는 사업장의 정보 및 장애인 훈련생(취업자)의 개인정보를 보호·관리·유지하여 누설하여서는 안 되며, 이를 위반하는 경우 모든 책임은 "을"이 진다.`);

  art("제9조【재해보상】");
  sub(`"을"이 업무상 재해를 당하였을 경우 산업재해보상보험법에 의거 보상한다.`);

  art("제10조【배상】");
  sub(`"을"은 다음 각 호에 해당하는 경우에는 "갑"에게 배상하여야 한다.`);
  sub(`1. 거짓 또는 그 밖의 부정한 방법으로 임금을 받았을 경우`, { indent: mm(6) });
  sub(`2. 지원고용사업의 사업적 부분의 손해를 활동하는 경우`, { indent: mm(6) });

  art("제11조【계약해지 및 해고】");
  sub(`① "갑"은 다음 각 호에 해당하는 경우 계약 만료 전이라도 계약을 해지할 수 있다.`);
  sub(`1. "갑"이 지원고용(직무지도원 관리) 사업을 중단하였을 경우`, { indent: mm(6) });
  sub(`2. 장애인 훈련생(취업자)의 현장훈련 거부·취소 등 현장훈련(취업)이 종료된 경우`, { indent: mm(6) });
  sub(`3. 장애인 근로자가 속한 사업주에게 근로를 제공하는 등 직무지도원 의무를 성실히 수행하지 않을 경우`, { indent: mm(6) });
  sub(`4. "을"이 무단·조퇴·음주·근무지 이탈, 위탁기관의 지시 불응 등 근무태도가 불성실한 경우`, { indent: mm(6) });
  sub(`5. 신체·정신상의 이유로 업무수행이 곤란한 경우`, { indent: mm(6) });
  sub(`② "을"은 다음 각 호에 해당하는 경우 계약을 해지할 수 있다.`);
  sub(`1. 제8조(의무)를 이행하지 않을 경우 / 제10조(배상)에 해당하는 경우`, { indent: mm(6) });
  sub(`2. "갑"이 지정한 장애인 훈련생(취업자)과 특별한 사유 없이 3번 이상 근로를 거부하였을 경우`, { indent: mm(6) });
  sub(`3. 제반 관련 규정을 위반하여 중대한 민원 및 "갑"에 손실을 입혔을 경우`, { indent: mm(6) });

  art("제12조【근로기준법의 적용】");
  sub(`본 계약서에 명시되지 않은 사항은 ${emp} 취업규칙 및 운영규정, 또는 근로기준법령 관계법령에 따른다.`);

  art("제13조【근로계약서 교부】");
  sub(`본 계약서는 "갑"과 "을"의 서명날인 즉시 그 효력이 발생하며, 계약서에 날인한 후 각각 1부씩 보관한다.`);

  // 작성일
  y += mm(4);
  if (y + mm(48) > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
  doc.font("KR").fontSize(11).fillColor("#000").text(p.dateText || "          년      월      일", x, y, { width: W, align: "center" });
  y += mm(10);

  // 갑/을 2열 서명란
  const colL = x, colR = x + mm(90);
  doc.font("KR-Bold").fontSize(11).text("[ 갑 ]", colL, y, { width: mm(80), align: "center" });
  doc.text("[ 을 ]", colR, y, { width: mm(80), align: "center" });
  y += mm(9);

  const fmtBirth = (b?: string) => (b ? String(b).replace(/-/g, ".") : "");
  const drawImg = (url: string | undefined, ix: number, iy: number) => {
    if (!url || !String(url).startsWith("data:image")) return;
    try {
      const img = Buffer.from(url.split(",")[1], "base64");
      const meta = pngSize(img);
      const square = !!meta && Math.abs(meta.w / meta.h - 1) < 0.12;
      if (square) doc.image(img, ix, iy - mm(6), { fit: [mm(16), mm(16)] });
      else doc.image(img, ix, iy - mm(3), { fit: [mm(28), mm(11)] });
    } catch { /* 무시 */ }
  };
  const rowL = (label: string, val: string) => { doc.font("KR").fontSize(10).fillColor("#000").text(`■ ${label} : ${val || ""}`, colL, y, { width: mm(85) }); };
  const rowR = (label: string, val: string) => { doc.font("KR").fontSize(10).fillColor("#000").text(`■ ${label} : ${val || ""}`, colR, y, { width: mm(80) }); };

  // 1행: 기관명/직인  |  이름/서명
  rowL("위탁기관명", emp); drawImg(p.signatures?.employer?.imageUrl, colL + mm(55), y); // 직인
  rowR(cfg.eulNameLabel, wkr); drawImg(p.signatures?.worker?.imageUrl, colR + mm(50), y);
  y += mm(8);
  rowL("대 표 자", p.employerRepName || ""); rowR("생년월일", fmtBirth(p.workerBirthDate ?? td.workerBirthDate)); y += mm(8);
  rowL("소 재 지", p.employerAddress || ""); rowR("연 락 처", p.workerPhone || ""); y += mm(8);
  rowR("주    소", p.workerAddress || ""); y += mm(8);

  return toBuffer(doc);
}

// ── 07 성동 전용(개편) — 06과 동일 레이아웃 + 밑줄=볼드 + 제4조 표 + 제3조⑧ 듣고인지(손글씨+작은 서명) ──
// 원본(docs/07…png)을 크롭으로 직접 판독해 조문 전사. 밑줄 데이터는 Batang-Bold.
function instContract07(p: any): Promise<Buffer> {
  const doc = newDoc(20);
  const x = mm(20), W = mm(170);
  const won = (n: any) => (n == null || n === "" ? "______" : `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}`);
  const td = p.templateData ?? {};
  const BODY = 10.5;
  const CS = 0.4;   // 본문 자간(전체 넓힘)
  let y = mm(22);

  doc.font("Batang-Bold").fontSize(18).fillColor("#000").text("직무지도원 표준근로계약서", x, y, { width: W, align: "center", characterSpacing: 1.0 });
  y += mm(15);

  const divider = (gapBefore = mm(2.4), gapAfter = mm(2.4)) => {
    y += gapBefore;
    if (y > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    doc.moveTo(x, y).lineTo(x + W, y).lineWidth(0.5).strokeColor("#000").stroke();
    y += gapAfter;
  };

  type Seg = string | { u: string } | { uw: string }; // u=데이터(여유패딩), uw=문장 전체밑줄
  const D = (v: string | number | null | undefined): Seg => ({ u: (v == null || String(v) === "" ? "            " : String(v)) });
  const WJ = String.fromCharCode(0x2060);
  const keep = (s: string) => s.replace(/(\S)(?=\S)/g, `$1${WJ}`);
  const padParty = (s: string) => s.replace(/\s*"갑"\s*/g, ' "갑" ').replace(/\s*"을"\s*/g, ' "을" ');

  // 07: 밑줄(데이터) 세그먼트는 볼드(Batang-Bold)로 렌더
  const para = (segs: Seg[], opts: { indent?: number; gap?: number; size?: number; bold?: boolean; firstIndent?: number } = {}) => {
    const { indent = mm(3), gap = mm(1.6), size = BODY, bold = false, firstIndent = 0 } = opts;
    const lx = x + indent, lw = W - indent;
    const isU = (s: Seg) => typeof s !== "string";
    const text = (s: Seg): string => {
      if (typeof s === "string") return keep(padParty(s));
      if ("uw" in s) return keep(padParty(s.uw));
      return `    ${keep(s.u)}    `;
    };
    const hasUw = segs.some(s => typeof s !== "string" && "uw" in s);
    const measureFont = bold || hasUw ? "Batang-Bold" : "Batang";
    const plain = segs.map(text).join("");
    doc.font(measureFont).fontSize(size);
    const h = doc.heightOfString(plain, { width: lw, lineGap: 2, indent: firstIndent, characterSpacing: CS });
    if (y + h > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    const y0 = y;
    segs.forEach((s, i) => {
      const o: any = { width: lw, lineGap: 2, continued: i !== segs.length - 1, underline: isU(s), characterSpacing: CS };
      if (i === 0 && firstIndent) o.indent = firstIndent;
      doc.font(bold ? "Batang-Bold" : (isU(s) ? "Batang-Bold" : "Batang")).fontSize(size).fillColor("#000");
      if (i === 0) doc.text(text(s), lx, y0, o); else doc.text(text(s), o);
    });
    y = y0 + h + gap;
  };
  const art = (t: string) => para([t], { bold: true, indent: 0, gap: mm(1.2), size: 12.5 });
  const sub = (t: string, o: { indent?: number } = {}) => para([t], { indent: o.indent ?? mm(3) });

  const emp = p.employerBizName || "________________";
  const wkr = p.workerName || "________";

  divider(mm(3), mm(3));
  para([D(emp), ` (이하 "갑"이라 한다)와 `, D(wkr), ` (이하 "을"이라 한다)는 다음과 같이 근로계약을 체결하고 상호 성실히 이행할 것을 약정한다.`], { indent: 0, gap: mm(0.5), firstIndent: mm(4) });
  divider(mm(3), mm(3));

  art("제1조【근로계약기간】");
  para([`① `, { uw: `"을"의 근로계약기간은 ${p.contractStartText || "____년 __월 __일"} ~ ${p.contractEndText || "____년 __월 __일"}까지로 한다.` }]);
  sub(`② 근로계약 만료 시 또는 훈련생(취업자) 지원고용 현장훈련(취업 후 적응지도) 등 서비스가 종료된 경우 본 계약은 종료된 것으로 간주한다.`);
  divider();

  art("제2조【근로 장소 및 직무】");
  para([`① `, { uw: `"을"의 근로 장소는 장애인 훈련생(취업자)이 훈련(근무)하는 ( ${p.workLocation || "____________"} )으로 한다.` }, ` 단, 업무상 필요한 경우 "갑"은 "을"과 협의하여 근로 장소를 변경할 수 있다.`]);
  para([`② "을"의 직무는 장애인 훈련생(취업자)이 장애로 인하여 독자적인 현장훈련(적응)이 어려운 경우 직무지도원을 배치하여 안정적·지속적으로 지원하는 `, { uw: `중증장애인 지원고용 직무지도` }, `로 한다.`]);
  divider();

  art("제3조【임금】");
  sub(`① "을"의 임금은 지원고용 사업안내에 따라 시급제로 지급된다.`);
  para([`② `, { uw: `"을"의 시급은 당해 연도 최저시급(${won(p.wageAmount)}원)이며, 주휴수당은 별도로 지급한다.` }]);
  para([`③ `, { uw: `"을"이 장애인 훈련생(취업자)을 2인 이상 동시에 지원(직무지도)하는 경우 시급의 120%를 지급한다. 다만 지원고용 현장훈련(적응지도) 중 직무지도 훈련생의 변동이 있는 경우(1명 지도) 일할로 계산한다.` }]);
  sub(`④ 별도 수당은 위탁기관 사정에 따라 지급할 수 있다.`);
  para([`⑤ 임금은 매월 1일부터 말일까지를 계산하여 익월 `, D(p.wagePayday || "10"), `일에 지급한다.`]);
  sub(`⑥ 지급일이 휴일인 경우 전일에 지급하며, 지급방법은 "을" 명의의 통장으로 입금한다.`);
  sub(`⑦ 월 실지급액은 사회보험료(국민연금, 건강보험, 고용보험)를 제외한 금액이다.`);
  // ⑧ 듣고 인지 — 첫 괄호=손글씨(따라쓰기), 둘째 괄호=작은 서명(본문용). 한 줄 수동 배치.
  {
    if (y + mm(9) > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    const cy = y, lx = x + mm(3);
    const f = () => doc.font("Batang").fontSize(BODY).fillColor("#000");
    f(); const s1 = `⑧ "을"은 "갑"으로부터 3조(임금)의 내용을 (`; doc.text(s1, lx, cy, { lineBreak: false });
    let cx = lx + doc.widthOfString(s1);
    const hwW = mm(36), hw = td.heardHandwritingUrl;
    // 손글씨는 본문 글자(BODY)와 비슷한 높이로 자동 축소(fit). 입력은 크게 받아도 여기서 맞춰짐.
    if (hw && String(hw).startsWith("data:image")) { try { doc.image(Buffer.from(hw.split(",")[1], "base64"), cx + mm(2), cy - mm(0.8), { fit: [hwW - mm(3), mm(5)] }); } catch { /* 무시 */ } }
    else { doc.font("Batang").fontSize(BODY).fillColor("#9ca3af").text("듣고 인지했음", cx + mm(2), cy, { lineBreak: false }); }
    cx += hwW;
    f(); const s2 = `)을 확인 (`; doc.text(s2, cx, cy, { lineBreak: false });
    cx += doc.widthOfString(s2);
    const sigW = mm(22), sig = p.signatures?.worker;
    if (sig?.imageUrl && String(sig.imageUrl).startsWith("data:image")) { try { doc.image(Buffer.from(sig.imageUrl.split(",")[1], "base64"), cx + mm(1), cy - mm(2.5), { fit: [sigW - mm(2), mm(7)] }); } catch { /* 무시 */ } }
    cx += sigW;
    f(); doc.text(`) 한다.`, cx, cy, { lineBreak: false });
    y = cy + mm(7);
  }
  divider();

  art("제4조【근로시간 및 휴게시간】");
  sub(`① 근로일별 소정근로시간은 아래와 같고 지원고용 현장훈련(취업 후 적응지도)서비스 지원시간으로 한다.`);
  {
    const toMin = (t?: string) => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
    const ws = toMin(p.workStartTime), we = toMin(p.workEndTime), bs = toMin(p.breakStartTime), be = toMin(p.breakEndTime);
    let workH = "";
    if (ws != null && we != null) { let mins = we - ws; if (bs != null && be != null) mins -= (be - bs); workH = (mins / 60).toFixed(1).replace(/\.0$/, ""); }
    const cols = [mm(48), mm(28), mm(28), mm(28), mm(38)];
    const head = ["근로일", "소정근로시간", "시업시각", "종업시각", "휴게시간"];
    const row = [`${p.contractStartText || ""}~`, workH || "", p.workStartTime || "", p.workEndTime || "", (p.breakStartTime || p.breakEndTime) ? `${p.breakStartTime || ""}~${p.breakEndTime || ""}` : ""];
    const rh = mm(7);
    if (y + rh * 2 > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
    const drawRow = (vals: string[], bold: boolean) => {
      let cx = x;
      doc.font(bold ? "Batang-Bold" : "Batang").fontSize(9).fillColor("#000");
      cols.forEach((cw, i) => {
        doc.lineWidth(0.6).rect(cx, y, cw, rh).stroke("#000");
        doc.text(vals[i] ?? "", cx + mm(1), y + (rh - doc.heightOfString(vals[i] ?? "", { width: cw - mm(2) })) / 2, { width: cw - mm(2), align: "center" });
        cx += cw;
      });
      y += rh;
    };
    drawRow(head, true); drawRow(row, false);
    y += mm(2);
  }
  sub(`② 휴게시간은 제1항의 표와 같되, 업무특성을 고려하여 장애인 훈련생(취업자)의 휴게시간에 따라 분할하여 부여할 수 있다.`);
  divider();

  art("제5조【근무일과 휴일】");
  sub(`① "을"은 장애인 훈련생(취업자)의 근무일에 근로하고, 주휴일은 일주일 동안 소정 근로일을 개근한 경우 1일의 유급휴일을 부여한다.`);
  sub(`② 근로자의 날(05월 01일)을 유급휴일로 부여한다.`);
  sub(`③ 휴일(공휴일 및 대체공휴일)에 관한 사항은 근로기준법 제55조에 정한 바로 한다.`);
  sub(`④ "갑"은 "을"이 유급 또는 무급휴일에 근로한 경우에는 근로기준법에 따른 대체휴무를 부여하거나, 수당을 지급한다.`);
  sub(`⑤ 연차유급휴가는 근로기준법에 따라 부여하며, 연차유급휴가 사용 시에는 장애인 훈련생(취업자)과 협의를 통하여 사용하여야 한다.`);
  sub(`⑥ 제1항과 제5항에도 불구하고 "을"의 소정 근로시간이 4주 동안(4주 미만으로 근로하는 경우에는 그 기간)을 평균하여 1주 동안 15시간 미만인 경우에는 주휴일, 관공서의 공휴일에 관한 규정에 의한 공휴일 및 대체공휴일과 연차유급휴가, 퇴직급여제도를 적용하지 아니한다.`);
  divider();

  art("제6조【의무】");
  sub(`① "을"은 지원고용 훈련일지 및 직무지도원 출근부를 매일 성실히 작성하여야 하며 "갑"에게 제출하여야 한다.`);
  sub(`② "을"은 "갑"에서 시행하는 교육 및 간담회에 참여하여야 한다.`);
  divider();

  art("제7조【복무】");
  sub(`① "을"은 업무수행 시 중대한 사항이 발생할 경우 "갑"에게 보고해야 한다.`);
  sub(`② "을"은 "갑"이 정한 「${emp} 취업규칙」 및 「${emp} 운영규정」의 적용을 받으며, 이를 준수하여야 한다.`);
  sub(`③ "을"은 장애인 훈련생(취업자)의 지원고용 현장훈련(취업 후 적응지도) 서비스 중단 등 중단사유가 발생할 경우 지체없이 "갑"에게 알려야 한다.`);
  sub(`④ "을"은 장애인 훈련생(취업자) 또는 사업장에서 부당한 행위를 당한 경우 즉시 "갑"에게 그 사실을 통지하여야 하며, "갑"은 "을"이 부당한 행위를 당하지 않도록 조치하여야 한다.`);
  sub(`⑤ 제4항의 조치사항 이행 시 "갑"은 "을"에게 불합리한 처우를 해서는 안 된다. 단, "을"에게 귀책사유가 있는 경우는 제외한다.`);
  divider();

  art("제8조【비밀유지】");
  sub(`① "갑"은 장애인 훈련생(취업자)의 개인정보를 목적 외에 다른 용도로 사용하거나 다른 사람 또는 기관에 제공하여서는 안 된다.`);
  sub(`② "을"은 업무수행 시 발생하는 사업장의 정보 및 장애인 훈련생(취업자)의 개인정보에 대해 타인에게 누설하여서는 안 되며, 이를 위반하는 경우 모든 책임은 "을"이 진다.`);
  divider();

  art("제9조【재해보상】");
  sub(`"을"이 업무상 재해를 당하였을 경우 산업재해보상보험법에 의거하여 보상한다.`);
  divider();

  art("제10조【배상】");
  sub(`"을"은 다음 각 호에 해당하는 경우에는 "갑"에게 배상하여야 한다.`);
  sub(`1. 거짓 또는 그 밖에 부정한 방법으로 임금을 받았을 경우`, { indent: mm(6) });
  sub(`2. 지원고용사업의 사업취지에 맞지 않게 활동하는 경우`, { indent: mm(6) });
  divider();

  art("제11조【계약해지 및 해고】");
  sub(`① "갑"은 다음 각 호에 해당하는 경우 계약 만료전이라도 "을"의 계약을 해지할 수 있다.`);
  sub(`1. "갑"이 지원고용(직무지도원 관리) 사업을 중단하였을 경우`, { indent: mm(6) });
  sub(`2. 장애인 훈련생(취업자)이 "을"의 근무를 거부하거나 장애인 훈련생(취업자)의 현장훈련(적응지도)이 종료된 경우`, { indent: mm(6) });
  sub(`3. 장애인 근로자가 속한 사업주에게 근로를 제공하는 등 직무지도원의 의무를 성실히 수행하지 않을 경우`, { indent: mm(6) });
  sub(`4. "을"이 지각, 조퇴, 음주, 근무지 이탈, 위탁기관의 지시 불응 등 근무태도가 불성실한 경우`, { indent: mm(6) });
  sub(`5. 신체 정신상의 이유로 업무수행이 곤란한 경우`, { indent: mm(6) });
  sub(`② "갑"은 "을"이 다음 각 호에 해당하는 경우 해고조치 할 수 있다.`);
  sub(`1. 제6조(의무)를 이행하지 않는 경우`, { indent: mm(6) });
  sub(`2. 제10조(배상)에 해당하는 경우`, { indent: mm(6) });
  sub(`3. "갑"이 지정하는 장애인 훈련생(취업자)과 특별한 사유 없이 3번 이상 근로를 거부한 경우`, { indent: mm(6) });
  sub(`4. 제반 관련 규정을 위반하여 중대한 민원 및 "갑"에 손실을 입혔을 경우`, { indent: mm(6) });
  sub(`5. "갑"의 복무규정 등을 중대하게 위반한 경우`, { indent: mm(6) });
  divider();

  art("제12조【근로기준법의 적용】");
  sub(`본 계약서에 명시되지 않는 사항은 「${emp} 취업규칙」 및 「${emp} 운영규정」 또는 근로기준법 등 관계법령이 정하는 바에 따른다.`);
  divider();

  art("제13조【근로계약서 교부】");
  sub(`본 계약은 "갑"과 "을"의 서명날인 즉시 그 효력이 발생하며 계약서에 날인한 후 각각 1부씩 보관한다.`);
  divider();

  // 작성일 + 갑/을 서명란이 한 페이지에 함께 들어가도록 충분한 잔여공간 확보(부족 시 새 페이지)
  if (y + mm(70) > pageBottom(doc)) { doc.addPage(); y = doc.page.margins.top; }
  y += mm(2);
  doc.font("Batang").fontSize(12).fillColor("#000").text(p.dateText || "          년      월      일", x, y, { width: W, align: "center" });
  y += mm(9);
  divider(mm(0), mm(6));

  // 갑/을 서명란
  const colL = x, colR = x + mm(90);
  doc.font("Batang-Bold").fontSize(14).text("[ 갑 ]", colL, y, { width: mm(80), align: "center" });
  doc.text("[ 을 ]", colR, y, { width: mm(80), align: "center" });
  y += mm(11);

  const SF = 9.5;
  const fmtBirth = (b?: string) => (b ? String(b).replace(/-/g, ".") : "");
  const drawImg = (url: string | undefined, ix: number, iy: number) => {
    if (!url || !String(url).startsWith("data:image")) return;
    try {
      const img = Buffer.from(url.split(",")[1], "base64");
      const meta = pngSize(img);
      const square = !!meta && Math.abs(meta.w / meta.h - 1) < 0.12;
      if (square) doc.image(img, ix, iy - mm(6), { fit: [mm(16), mm(16)] });
      else doc.image(img, ix, iy - mm(3), { fit: [mm(28), mm(11)] });
    } catch { /* 무시 */ }
  };
  const rowL = (label: string, val: string) => { doc.font("Batang").fontSize(SF).fillColor("#000").text(`■ ${label} : ${val || ""}`, colL, y, { width: mm(85) }); };
  const rowR = (label: string, val: string) => { doc.font("Batang").fontSize(SF).fillColor("#000").text(`■ ${label} : ${val || ""}`, colR, y, { width: mm(80) }); };
  const stampRow = (label: string, val: string, tag: string, gapChars: number, colX: number, img?: string) => {
    doc.font("Batang").fontSize(SF).fillColor("#000");
    const base = `■ ${label} : ${val || ""}`;
    doc.text(base, colX, y, { lineBreak: false });
    const tagX = colX + doc.widthOfString(base) + doc.widthOfString(" ") * gapChars;
    doc.text(tag, tagX, y, { lineBreak: false });
    if (img) drawImg(img, tagX, y);
  };

  const yTop = y, S = mm(8), Lg = (3 * S) / 2;
  y = yTop;          stampRow("위탁기관명", emp, "(직인)", 2, colL, p.signatures?.employer?.imageUrl);
  y = yTop + Lg;     rowL("대  표  자", p.employerRepName || "");
  y = yTop + 2 * Lg; rowL("소  재  지", p.employerAddress || "");
  y = yTop;          stampRow("이      름", wkr, "(서명/날인)", 8, colR, p.signatures?.worker?.imageUrl);
  y = yTop + S;      rowR("생 년 월 일", fmtBirth(p.workerBirthDate ?? td.workerBirthDate));
  y = yTop + 2 * S;  rowR("연  락  처", p.workerPhone || "");
  y = yTop + 3 * S;  rowR("주        소", p.workerAddress || "");
  y = yTop + 3 * S + mm(8);

  return toBuffer(doc);
}

// 양식별 래퍼 — 06=instContract(개편), 07=instContract07(개편). (instContract07Legacy는 미사용/보관)
function employmentContract07(p: any): Promise<Buffer> { return instContract07(p); }
function employmentContract06(p: any): Promise<Buffer> { return instContract(p, { eulNameLabel: "직무지도원", timeMode: "inline", showHeard: false, defaultPayday: "14" }); }

export type PdfDocType = "ATTENDANCE_SHEET" | "TRAINING_DAILY_LOG" | "ADAPTATION_DAILY_LOG" | "TRAINEE_FINAL_EVAL" | "ADAPTATION_FINAL_EVAL" | "PAYSLIP" | "EMPLOYMENT_CONTRACT";

export function renderPdfKit(documentType: PdfDocType, payload: any): Promise<Buffer> {
  switch (documentType) {
    case "ATTENDANCE_SHEET": return attendanceSheet(payload);
    case "TRAINING_DAILY_LOG": return dailyLog("TRAINING", payload);
    case "ADAPTATION_DAILY_LOG": return dailyLog("ADAPTATION", payload);
    case "TRAINEE_FINAL_EVAL": return finalEval("TRAINEE", payload);
    case "ADAPTATION_FINAL_EVAL": return finalEval("ADAPTATION", payload);
    case "PAYSLIP": return payslip(payload);
    case "EMPLOYMENT_CONTRACT": return employmentContract(payload);
    default: throw new Error(`Unsupported documentType: ${documentType}`);
  }
}
