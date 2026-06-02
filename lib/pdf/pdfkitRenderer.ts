// lib/pdf/pdfkitRenderer.ts
// 브라우저 없이(서버리스 안전) PDF 생성 — pdfkit + NotoSansKR.
// 기존 Playwright(chromium) 엔진은 Vercel 서버리스에서 동작 불가 → 대체.
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const FONT_REG = path.join(FONT_DIR, "NotoSansKR-Light.ttf");
const FONT_BOLD = path.join(FONT_DIR, "NotoSansKR-Bold.ttf");

// A4 (pt). 1mm ≈ 2.83465pt
const MARGIN = 40;

type Sig = { name?: string; imageUrl?: string };

function newDoc(): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  doc.registerFont("KR", fs.readFileSync(FONT_REG));
  doc.registerFont("KR-Bold", fs.readFileSync(FONT_BOLD));
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
};

// 셀 박스 + 세로중앙 텍스트
function cell(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, text: string | number | null | undefined, o: CellOpts = {}) {
  const { align = "center", bold = false, size = 9, fill, vertical = false, pad = 2, border = true } = o;
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
  const th = doc.heightOfString(t, { width: tw, align });
  const ty = y + Math.max(0, (h - th) / 2);
  doc.text(t, x + pad, ty, { width: tw, align });
}

function title(doc: PDFKit.PDFDocument, text: string, y: number, size = 17): number {
  doc.font("KR-Bold").fontSize(size).fillColor("#000");
  const w = doc.page.width - MARGIN * 2;
  doc.text(text, MARGIN, y, { width: w, align: "center" });
  return y + doc.heightOfString(text, { width: w, align: "center" }) + 10;
}

// 서명란 (라벨: 이름 (서명 또는 인)[+이미지])
function signatures(doc: PDFKit.PDFDocument, y: number, rows: { label: string; sig?: Sig }[]): number {
  const right = doc.page.width - MARGIN;
  let cy = y + 6;
  doc.fontSize(11);
  for (const r of rows) {
    const name = r.sig?.name ?? "";
    const line = `${r.label} : ${name}    (서명 또는 인)`;
    doc.font("KR").fillColor("#000").text(line, MARGIN, cy, { width: right - MARGIN, align: "right" });
    // 서명 이미지(있으면) 텍스트 위에 겹쳐 그림
    if (r.sig?.imageUrl && r.sig.imageUrl.startsWith("data:image")) {
      try {
        const b64 = r.sig.imageUrl.split(",")[1];
        const img = Buffer.from(b64, "base64");
        doc.image(img, right - 70, cy - 4, { fit: [60, 22], align: "center" });
      } catch { /* 이미지 실패 무시 */ }
    }
    cy += 24;
  }
  return cy;
}

function pageBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - MARGIN;
}

// 헤더 반복 + 페이지 넘김을 지원하는 행 테이블
function rowTable(
  doc: PDFKit.PDFDocument,
  opts: {
    x: number; top: number; colWidths: number[];
    header: { text: string; align?: CellOpts["align"] }[];
    rows: { text: string; align?: CellOpts["align"] }[][];
    headerH?: number; rowH?: number; size?: number; headerSize?: number;
  },
): number {
  const { x, colWidths, header, rows, headerH = 22, rowH = 20, size = 8.5, headerSize = 8.5 } = opts;
  let y = opts.top;
  const drawHeader = () => {
    let cx = x;
    header.forEach((hc, i) => { cell(doc, cx, y, colWidths[i], headerH, hc.text, { align: hc.align ?? "center", bold: true, size: headerSize, fill: "#f0f0f0" }); cx += colWidths[i]; });
    y += headerH;
  };
  drawHeader();
  for (const row of rows) {
    // 행 높이 동적: 가장 긴 셀 기준
    let needed = rowH;
    row.forEach((c, i) => {
      doc.font("KR").fontSize(size);
      const h = doc.heightOfString(c.text || "", { width: colWidths[i] - 4, align: c.align ?? "center" }) + 8;
      if (h > needed) needed = h;
    });
    if (y + needed > pageBottom(doc)) { doc.addPage(); y = MARGIN; drawHeader(); }
    let cx = x;
    row.forEach((c, i) => { cell(doc, cx, y, colWidths[i], needed, c.text, { align: c.align ?? "center", size }); cx += colWidths[i]; });
    y += needed;
  }
  return y;
}

// ── 1) 출근부 ───────────────────────────────────────────────
function attendanceSheet(p: any): Promise<Buffer> {
  const doc = newDoc();
  const x = MARGIN, W = doc.page.width - MARGIN * 2;
  let y = title(doc, "직무지도원 출근부", MARGIN);

  // 정보 표 (2열 라벨/값)
  const lc = 90, vc = W / 2 - lc;
  const info: [string, string, string, string][] = [
    ["성명", p.workerName ?? "", "연락처", p.workerPhone ?? ""],
    ["배치사업체명", p.companyName ?? "", "지도기간", `${p.periodStartYMD ?? ""} ~ ${p.periodEndYMD ?? ""}`],
    ["지도일수 및 시간", `총 ${p.totalDays ?? 0}일, 총 ${p.totalHours ?? 0}h`, "주휴수당 등", `주휴 ${p.weeklyHolidayCount ?? 0}회 월차 ${p.monthlyLeaveCount ?? 0}회 / 총 ${p.allowanceTotalWon ?? 0}원`],
    ["일반 지도시간(1:1)", `총 ${p.oneToOneHours ?? 0}h`, "1:多 지도시간", `총 ${p.oneToManyHours ?? 0}h`],
    ["연장 지도시간(1:1)", `총 ${p.otOneToOneHours ?? 0}h`, "연장 1:多 지도시간", `총 ${p.otOneToManyHours ?? 0}h`],
  ];
  const ih = 26;
  for (const r of info) {
    cell(doc, x, y, lc, ih, r[0], { bold: true, size: 8.5, fill: "#f5f5f5" });
    cell(doc, x + lc, y, vc, ih, r[1], { size: 9 });
    cell(doc, x + lc + vc, y, lc, ih, r[2], { bold: true, size: 8.5, fill: "#f5f5f5" });
    cell(doc, x + lc * 2 + vc, y, W - lc * 2 - vc, ih, r[3], { size: 9 });
    y += ih;
  }

  doc.font("KR").fontSize(8.5).fillColor("#000").text("※ 주휴수당은 위탁기관 담당자가 작성", x, y + 4);
  y += 18;
  doc.font("KR-Bold").fontSize(11).text("■ 근무상황표", x, y); y += 18;

  // 근무상황표: 일자별 행 (날짜/출근/퇴근/지도시간/1:多)
  const entries: any[] = Array.isArray(p.entries) ? p.entries : [];
  const cw = [70, 95, 95, 95, W - 355];
  const rows = entries.length
    ? entries.map((e) => [
        { text: String(e.date ?? e.workDate ?? "") },
        { text: String(e.start ?? e.startTime ?? "") },
        { text: String(e.end ?? e.endTime ?? "") },
        { text: e.hours != null && e.hours !== "" ? `${e.hours}h` : "" },
        { text: (e.multiHours ?? e.oneToManyHours) ? `${e.multiHours ?? e.oneToManyHours}h` : "" },
      ])
    : [[{ text: "기록 없음" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }]];
  y = rowTable(doc, {
    x, top: y, colWidths: cw,
    header: [{ text: "일자" }, { text: "출근" }, { text: "퇴근" }, { text: "총 지도시간" }, { text: "1:多 지도" }],
    rows, headerH: 22, rowH: 22,
  });

  y += 16;
  doc.font("KR").fontSize(10).text("위와 같이 근무(출근) 하였음을 확인함", x, y, { width: W, align: "center" }); y += 18;
  const today = new Date();
  doc.text(`${today.getFullYear()}년    ${today.getMonth() + 1}월    ${today.getDate()}일`, x, y, { width: W, align: "center" }); y += 20;

  const s = p.signatures ?? {};
  signatures(doc, y, [
    { label: "(공단/위탁기관) 담당자", sig: s.govAgent },
    { label: "사업체담당자", sig: s.companyManager },
    { label: "직무지도원", sig: s.worker },
  ]);
  return toBuffer(doc);
}

// ── 2) 훈련일지 / 3) 적응지도 일지 (공통 레이아웃) ───────────────
function dailyLog(kind: "TRAINING" | "ADAPTATION", p: any): Promise<Buffer> {
  const doc = newDoc();
  const x = MARGIN, W = doc.page.width - MARGIN * 2;
  const isAdapt = kind === "ADAPTATION";
  let y = title(doc, isAdapt ? "직무지도원을 활용한 취업 후 적응지도 일지" : "지원고용 훈련일지", MARGIN, isAdapt ? 14 : 16);

  // 메타
  const ih = 24;
  if (isAdapt) {
    const c1 = 150, c2 = (W - 150) / 2;
    cell(doc, x, y, c1, ih, "근로자명", { bold: true, fill: "#f5f5f5", size: 9 });
    cell(doc, x + c1, y, c2, ih, p.traineeName ?? "", { size: 9 });
    cell(doc, x + c1 + c2, y, c1, ih, "사업체명", { bold: true, fill: "#f5f5f5", size: 9 });
    cell(doc, x + c1 * 2 + c2, y, W - c1 * 2 - c2, ih, p.companyName ?? "", { size: 9 });
    y += ih;
    cell(doc, x, y, c1, ih, "적응지도기간", { bold: true, fill: "#f5f5f5", size: 9 });
    cell(doc, x + c1, y, W - c1, ih, `${p.periodStart ?? ""} ~ ${p.periodEnd ?? ""}`, { size: 9 });
    y += ih;
  } else {
    const lc = 90;
    const half = W / 2;
    cell(doc, x, y, lc, ih, "훈련생명", { bold: true, fill: "#f5f5f5", size: 9 });
    cell(doc, x + lc, y, half - lc, ih, p.traineeName ?? "", { size: 9 });
    cell(doc, x + half, y, lc, ih, "사업체명", { bold: true, fill: "#f5f5f5", size: 9 });
    cell(doc, x + half + lc, y, W - half - lc, ih, p.companyName ?? "", { size: 9 });
    y += ih;
    cell(doc, x, y, lc, ih, "사전훈련", { bold: true, fill: "#f5f5f5", size: 9 });
    cell(doc, x + lc, y, half - lc, ih, p.periodPreText ?? "", { size: 8.5 });
    cell(doc, x + half, y, lc, ih, "현장훈련", { bold: true, fill: "#f5f5f5", size: 9 });
    cell(doc, x + half + lc, y, W - half - lc, ih, p.periodFieldText ?? "", { size: 8.5 });
    y += ih;
  }
  y += 12;

  // 본문 테이블
  if (isAdapt) {
    const entries: any[] = Array.isArray(p.entries) ? p.entries : [];
    const cw = [36, 50, 44, 70, 60, W - 36 - 50 - 44 - 70 - 60 - 120, 60, 120].slice(0); // recompute below
    // 컬럼: 구분/지도일자/출결/근무시간/지도여부/수행과제/수행정도/지도사항
    const widths = [40, 52, 44, 64, 58, 110, 60, W - (40 + 52 + 44 + 64 + 58 + 110 + 60)];
    const rows = (entries.length ? entries : [{}]).map((e, i) => [
      { text: i === 0 ? "적응지도" : "〃" },
      { text: String(e.dateMD ?? e.dateISO ?? "") },
      { text: String(e.attendance ?? "") },
      { text: String(e.workTime ?? "") },
      { text: String(e.guidance ?? "") },
      { text: String(e.task ?? ""), align: "left" as const },
      { text: `${e.performanceLabel ?? ""}${e.performanceTime ? ` (${e.performanceTime})` : ""}` },
      { text: String(e.coaching ?? ""), align: "left" as const },
    ]);
    y = rowTable(doc, {
      x, top: y, colWidths: widths,
      header: [{ text: "구분" }, { text: "지도일자" }, { text: "출결" }, { text: "근무시간" }, { text: "지도여부" }, { text: "수행과제" }, { text: "수행정도\n(측정시간)" }, { text: "지도사항" }],
      rows, headerH: 30, rowH: 26,
    });
    // 특이사항
    const ihh = 30;
    cell(doc, x, y, 40, ihh, "특이사항", { bold: true, size: 8, fill: "#f5f5f5" });
    cell(doc, x + 40, y, W - 40, ihh, p.issues ?? "", { align: "left", size: 9 });
    y += ihh + 16;
    const s = p.signatures ?? {};
    signatures(doc, y, [{ label: "직무지도원", sig: s.worker }, { label: "위탁기관 담당자", sig: s.govAgent }]);
  } else {
    const rowsData: any[] = Array.isArray(p.rows) ? p.rows : [];
    const widths = [34, 56, 44, 44, 44, 100, 70, W - (34 + 56 + 44 + 44 + 44 + 100 + 70)];
    const rows = (rowsData.length ? rowsData : [{}]).map((r) => [
      { text: r.section === "PRE" ? "사전" : r.section === "FIELD" ? "현장" : "" },
      { text: String(r.date ?? "") },
      { text: String(r.attendanceStatus ?? "") },
      { text: String(r.trainingTime ?? "") },
      { text: String(r.guidanceFlag ?? "") },
      { text: String(r.task ?? ""), align: "left" as const },
      { text: String(r.taskLevelMeasured ?? "") },
      { text: String(r.evalGuidance ?? ""), align: "left" as const },
    ]);
    y = rowTable(doc, {
      x, top: y, colWidths: widths,
      header: [{ text: "구분" }, { text: "훈련일자" }, { text: "출결" }, { text: "훈련\n시간" }, { text: "지도\n여부" }, { text: "수행과제" }, { text: "수행정도\n(측정시간)" }, { text: "평가 및 지도사항" }],
      rows, headerH: 30, rowH: 26,
    });
    y += 16;
    const s = p.signatures ?? {};
    signatures(doc, y, [
      { label: "(공단/위탁기관) 담당자", sig: s.govAgent },
      { label: "사업체담당자", sig: s.companyManager },
      { label: "직무지도원", sig: s.worker },
    ]);
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
  const doc = newDoc();
  const x = MARGIN, W = doc.page.width - MARGIN * 2;
  const isTrainee = kind === "TRAINEE";
  let y = title(doc, isTrainee ? "지원고용 훈련생 종합 평가기록부" : "직무지도원을 활용한 적응지도 대상자 종합 평가기록부", MARGIN, isTrainee ? 15 : 13);

  // 메타
  const ih = 24;
  const lc = 80, half = W / 2;
  cell(doc, x, y, lc, ih, "대상자명", { bold: true, fill: "#f5f5f5", size: 9 });
  cell(doc, x + lc, y, half - lc, ih, p.traineeName ?? "", { size: 9 });
  cell(doc, x + half, y, lc, ih, "사업체명", { bold: true, fill: "#f5f5f5", size: 9 });
  cell(doc, x + half + lc, y, W - half - lc, ih, p.companyName ?? "", { size: 9 });
  y += ih;
  const periodTxt = isTrainee
    ? `사전 ${rangeDot(p.preTrainingStart, p.preTrainingEnd)}  /  현장 ${rangeDot(p.fieldTrainingStart, p.fieldTrainingEnd)}`
    : `${dot(p.periodStart)} ~ ${dot(p.periodEnd)}`;
  cell(doc, x, y, lc, ih, isTrainee ? "훈련기간" : "적응지도 기간", { bold: true, fill: "#f5f5f5", size: 8.5 });
  cell(doc, x + lc, y, W - lc, ih, periodTxt, { size: 8.5 });
  y += ih + 12;

  // 평가표
  const scores = p.scores ?? {};
  const comments = p.comments ?? {};
  const cw = [34, W - 34 - 36 - 36 - 150, 36, 36, 150]; // 구분/항목/사전(초기)/현장(후기)/소견
  // 헤더
  const hh = 22;
  let cx = x;
  const heads = ["구분", "평가 항목", isTrainee ? "사전" : "초기", isTrainee ? "현장" : "후기", "평가소견"];
  heads.forEach((h, i) => { cell(doc, cx, y, cw[i], hh, h, { bold: true, size: 9, fill: "#f0f0f0" }); cx += cw[i]; });
  y += hh;

  const rowH = 24;
  let totalI = 0, totalF = 0;
  for (const sec of EVAL_MASTER) {
    const arr: any[] = Array.isArray(scores[sec.code]) ? scores[sec.code] : [];
    const secH = rowH * sec.items.length;
    // 구분(세로) + 소견 박스(섹션 span)
    cell(doc, x, y, cw[0], secH, sec.label, { vertical: true, bold: true, size: 9, fill: "#fafafa" });
    cell(doc, x + cw[0] + cw[1] + cw[2] + cw[3], y, cw[4], secH, comments[sec.code] ?? "", { align: "left", size: 8.5 });
    let ry = y;
    sec.items.forEach((text, i) => {
      const s = arr[i] ?? {};
      const ini = s.initial ?? "";
      const fin = s.final ?? "";
      if (!isNaN(Number(ini)) && ini !== "") totalI += Number(ini);
      if (!isNaN(Number(fin)) && fin !== "") totalF += Number(fin);
      cell(doc, x + cw[0], ry, cw[1], rowH, text, { align: "left", size: 8 });
      cell(doc, x + cw[0] + cw[1], ry, cw[2], rowH, ini, { size: 9 });
      cell(doc, x + cw[0] + cw[1] + cw[2], ry, cw[3], rowH, fin, { size: 9 });
      ry += rowH;
    });
    y += secH;
  }
  // 총점
  cell(doc, x, y, cw[0] + cw[1], hh, "총 점(만점 100점)", { bold: true, size: 9, fill: "#f5f5f5" });
  cell(doc, x + cw[0] + cw[1], y, cw[2], hh, String(totalI), { bold: true, size: 9 });
  cell(doc, x + cw[0] + cw[1] + cw[2], y, cw[3], hh, String(totalF), { bold: true, size: 9 });
  cell(doc, x + cw[0] + cw[1] + cw[2] + cw[3], y, cw[4], hh, "", {});
  y += hh;
  // 비고
  cell(doc, x, y, cw[0] + cw[1], 18, "비고", { bold: true, size: 8.5, fill: "#f5f5f5" });
  cell(doc, x + cw[0] + cw[1], y, W - cw[0] - cw[1], 18, "※ 항목별 점수채점 : 우수 5점, 양호 4점, 보통 3점, 미흡 2점, 불량 1점", { align: "left", size: 7.5 });
  y += 18 + 18;

  const s = p.signatures ?? {};
  signatures(doc, y, [{ label: "직무지도원", sig: s.worker }, { label: "(위탁기관) 담당자", sig: s.agencyAgent }]);
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

export type PdfDocType = "ATTENDANCE_SHEET" | "TRAINING_DAILY_LOG" | "ADAPTATION_DAILY_LOG" | "TRAINEE_FINAL_EVAL" | "ADAPTATION_FINAL_EVAL";

export function renderPdfKit(documentType: PdfDocType, payload: any): Promise<Buffer> {
  switch (documentType) {
    case "ATTENDANCE_SHEET": return attendanceSheet(payload);
    case "TRAINING_DAILY_LOG": return dailyLog("TRAINING", payload);
    case "ADAPTATION_DAILY_LOG": return dailyLog("ADAPTATION", payload);
    case "TRAINEE_FINAL_EVAL": return finalEval("TRAINEE", payload);
    case "ADAPTATION_FINAL_EVAL": return finalEval("ADAPTATION", payload);
    default: throw new Error(`Unsupported documentType: ${documentType}`);
  }
}
