// lib/pdf/templates/TRAINING_DAILY_LOG.ts
// "지원고용 훈련일지" 원본 서식에 최대한 유사하게 렌더링 (회전 텍스트 최소화)
// - 헤더/구분/사전훈련/현장훈련: 회전이 아니라 "세로 적층(줄바꿈)"으로 구현
// - 1p: 타이틀 + 메타(훈련생명/사업체명/훈련기간(사전/현장))
// - 표: 헤더 + 행, 구분은 rowSpan(연속 구간 기준)
// - 2p~: 타이틀/메타 없이 표 헤더부터 반복
// - 마지막 p 하단: 서명 3행

import { PdfCanvas } from "../core/PdfCanvas";

type Section = "PRE" | "FIELD";

export type TrainingDailyLogRow = {
  section?: Section;

  date?: string;                 // 훈련일자
  attendanceStatus?: string;      // 출석/결석/지각/조퇴
  trainingTime?: string;          // 훈련시간
  // 원본에는 "출퇴근" 칼럼이 존재하나 기입칸은 비어있는 경우가 많음
  commute?: string;               // (옵션)
  guidanceFlag?: string;          // 지도 및 휴게시간 지도 여부
  task?: string;                  // 수행과제
  taskLevelMeasured?: string;     // 수행정도(측정시간)
  evalGuidance?: string;          // 평가 및 지도사항
};

export type TrainingDailyLogPayload = {
  traineeName?: string;
  companyName?: string;
  periodPre?: string;
  periodField?: string;
  rows?: TrainingDailyLogRow[];
};

function norm(payload: any): Required<TrainingDailyLogPayload> {
  const p = (payload ?? {}) as TrainingDailyLogPayload;
  const rows = Array.isArray(p.rows) ? p.rows : [];
  return {
    traineeName: p.traineeName ?? "",
    companyName: p.companyName ?? "",
    periodPre: p.periodPre ?? "",
    periodField: p.periodField ?? "",
    rows: rows.map((r) => ({
      section: (r?.section ?? "FIELD") as Section,
      date: r?.date ?? "",
      attendanceStatus: r?.attendanceStatus ?? "",
      trainingTime: r?.trainingTime ?? "",
      commute: r?.commute ?? "",
      guidanceFlag: r?.guidanceFlag ?? "",
      task: r?.task ?? "",
      taskLevelMeasured: r?.taskLevelMeasured ?? "",
      evalGuidance: r?.evalGuidance ?? "",
    })),
  };
}

function vstack(text: string) {
  // "구분" -> "구\n분", "사전훈련" -> "사\n전\n훈\n련"
  const t = (text ?? "").trim();
  return t.split("").join("\n");
}

function groupRuns(rows: TrainingDailyLogRow[]) {
  const runs: { section: Section; rows: TrainingDailyLogRow[] }[] = [];
  for (const r of rows) {
    const sec = (r.section ?? "FIELD") as Section;
    const last = runs[runs.length - 1];
    if (!last || last.section !== sec) runs.push({ section: sec, rows: [r] });
    else last.rows.push(r);
  }
  return runs;
}

export async function renderTRAINING_DAILY_LOG(opts: { canvas: PdfCanvas; payload: any }) {
  const canvas = opts.canvas;
  const data = norm(opts.payload);

  const margin = canvas.margin;
  const pageW = canvas.pageWidth;
  const pageH = canvas.pageHeight;

  const x0 = margin;
  const w0 = pageW - margin * 2;

  // 원본 느낌: 상단 여백 충분히 확보
  let y = margin + 8;

  const lineW = 0.8;

  const contentBottom = pageH - margin;

  const ensure = (h: number, withTableHeader: boolean) => {
    if (y + h <= contentBottom) return;
    canvas.addPage();
    y = margin + 8;
    if (withTableHeader) drawTableHeader();
  };

  // =====================
  // 1) Title
  // =====================
  const drawTitle = () => {
    canvas.setFont("bold", 14);
    canvas.drawText({ x: x0, y, w: w0, text: "지원고용 훈련일지", align: "center" });
    y += 20;
  };

  // =====================
  // 2) Meta box (원본: 훈련기간이 사전/현장 2행) :contentReference[oaicite:2]{index=2}
  // =====================
  const drawMeta = () => {
    const metaH = 42;
    const headerH = 16;
    const bodyH = metaH - headerH;
    const subH = Math.floor(bodyH / 2);

    ensure(metaH + 10, false);

    // 3개 큰 칸: 훈련생명 / 사업체명 / 훈련기간
    const wTrainee = Math.round(w0 * 0.24);
    const wCompany = Math.round(w0 * 0.36);
    const wPeriod = w0 - wTrainee - wCompany;

    const px = x0 + wTrainee + wCompany;

    // outer
    canvas.drawRect(x0, y, w0, metaH, lineW);
    canvas.drawLine(x0 + wTrainee, y, x0 + wTrainee, y + metaH, lineW);
    canvas.drawLine(x0 + wTrainee + wCompany, y, x0 + wTrainee + wCompany, y + metaH, lineW);
    canvas.drawLine(x0, y + headerH, x0 + w0, y + headerH, lineW);

    // period 내부: 좌측 라벨(사전/현장) + 우측 값, 그리고 2행 분리
    const periodLabelW = 44;
    canvas.drawLine(px + periodLabelW, y + headerH, px + periodLabelW, y + metaH, lineW);
    canvas.drawLine(px, y + headerH + subH, px + wPeriod, y + headerH + subH, lineW);

    canvas.setFont("bold", 9);
    canvas.textBox({ x: x0, y, w: wTrainee, h: headerH, text: "훈련생명", align: "center", valign: "middle", fontSize: 9, bold: true, padding: 2, lineGap: 1 });
    canvas.textBox({ x: x0 + wTrainee, y, w: wCompany, h: headerH, text: "사업체명", align: "center", valign: "middle", fontSize: 9, bold: true, padding: 2, lineGap: 1 });
    canvas.textBox({ x: px, y, w: wPeriod, h: headerH, text: "훈 련 기 간", align: "center", valign: "middle", fontSize: 9, bold: true, padding: 2, lineGap: 1 });

    canvas.setFont("regular", 9);
    canvas.textBox({ x: x0, y: y + headerH, w: wTrainee, h: bodyH, text: data.traineeName || "-", align: "center", valign: "middle", fontSize: 9, padding: 2, lineGap: 1 });
    canvas.textBox({ x: x0 + wTrainee, y: y + headerH, w: wCompany, h: bodyH, text: data.companyName || "-", align: "center", valign: "middle", fontSize: 9, padding: 2, lineGap: 1 });

    canvas.textBox({ x: px, y: y + headerH, w: periodLabelW, h: subH, text: "사전", align: "center", valign: "middle", fontSize: 9, padding: 2, lineGap: 1 });
    canvas.textBox({ x: px + periodLabelW, y: y + headerH, w: wPeriod - periodLabelW, h: subH, text: data.periodPre || "-", align: "left", valign: "middle", fontSize: 9, padding: 3, lineGap: 1 });

    canvas.textBox({ x: px, y: y + headerH + subH, w: periodLabelW, h: bodyH - subH, text: "현장", align: "center", valign: "middle", fontSize: 9, padding: 2, lineGap: 1 });
    canvas.textBox({ x: px + periodLabelW, y: y + headerH + subH, w: wPeriod - periodLabelW, h: bodyH - subH, text: data.periodField || "-", align: "left", valign: "middle", fontSize: 9, padding: 3, lineGap: 1 });

    y += metaH + 10;
  };

  // =====================
  // 3) Table layout (원본 헤더 구성에 맞춤) :contentReference[oaicite:3]{index=3}
  // =====================
  const col = {
    section: 20,      // 구분(세로 적층 + rowSpan)
    date: 64,         // 훈련일자
    status: 60,       // 출석/결석/지각/조퇴 (세로 적층)
    time: 52,         // 훈련시간 (세로 적층)
    commute: 44,      // 출퇴근 (세로 적층)
    flag: 52,         // 지도 및 휴게시간 지도 여부 (세로 적층)
    task: 92,         // 수행과제
    level: 76,        // 수행정도(측정시간)
    eval: 0,          // 평가 및 지도사항(잔여)
  };
  const fixed = col.section + col.date + col.status + col.time + col.commute + col.flag + col.task + col.level;
  col.eval = Math.max(90, w0 - fixed);

  const tableX = x0;
  const tableW = w0;

  const headerH = 56; // 원본처럼 헤더가 높음
  const rowH = 60;    // 원본 빈칸 크기 근사

  const xs = [
    tableX,
    tableX + col.section,
    tableX + col.section + col.date,
    tableX + col.section + col.date + col.status,
    tableX + col.section + col.date + col.status + col.time,
    tableX + col.section + col.date + col.status + col.time + col.commute,
    tableX + col.section + col.date + col.status + col.time + col.commute + col.flag,
    tableX + col.section + col.date + col.status + col.time + col.commute + col.flag + col.task,
    tableX + col.section + col.date + col.status + col.time + col.commute + col.flag + col.task + col.level,
    tableX + tableW,
  ];

  const drawTableHeader = () => {
    ensure(headerH + 2, false);

    canvas.drawRect(tableX, y, tableW, headerH, lineW);
    for (let i = 1; i < xs.length - 1; i++) {
      canvas.drawLine(xs[i], y, xs[i], y + headerH, lineW);
    }

    canvas.setFont("bold", 8);

    // 구분(세로 적층)
    canvas.textBox({
      x: xs[0],
      y,
      w: col.section,
      h: headerH,
      text: vstack("구분"),
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 1,
      lineGap: 1,
    });

    // 훈련일자
    canvas.textBox({
      x: xs[1],
      y,
      w: col.date,
      h: headerH,
      text: "훈련\n일자",
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 2,
      lineGap: 1,
    });

    // 출석/결석/지각/조퇴 (세로 적층)
    canvas.textBox({
      x: xs[2],
      y,
      w: col.status,
      h: headerH,
      text: "출석/결석/\n지각/조퇴",
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 2,
      lineGap: 1,
    });

    // 훈련시간 (세로 적층)
    canvas.textBox({
      x: xs[3],
      y,
      w: col.time,
      h: headerH,
      text: "훈련\n시간",
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 2,
      lineGap: 1,
    });

    // 출퇴근 (세로 적층)
    canvas.textBox({
      x: xs[4],
      y,
      w: col.commute,
      h: headerH,
      text: "출퇴\n근",
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 2,
      lineGap: 1,
    });

    // 지도 및 휴게시간 지도 여부 (세로 적층)
    canvas.textBox({
      x: xs[5],
      y,
      w: col.flag,
      h: headerH,
      text: "지도\n및\n휴게\n시간\n지도\n여부",
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 2,
      lineGap: 1,
    });

    // 수행과제
    canvas.textBox({
      x: xs[6],
      y,
      w: col.task,
      h: headerH,
      text: "수행과제",
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 2,
      lineGap: 1,
    });

    // 수행정도(측정시간)
    canvas.textBox({
      x: xs[7],
      y,
      w: col.level,
      h: headerH,
      text: "수행정도\n(측정시간)",
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 2,
      lineGap: 1,
    });

    // 평가 및 지도사항
    canvas.textBox({
      x: xs[8],
      y,
      w: col.eval,
      h: headerH,
      text: "평가 및 지도사항",
      align: "center",
      valign: "middle",
      fontSize: 8,
      bold: true,
      padding: 2,
      lineGap: 1,
    });

    y += headerH;
  };

  const drawRowFrame = (top: number, h: number) => {
    canvas.drawRect(tableX, top, tableW, h, lineW);
    for (let i = 1; i < xs.length - 1; i++) {
      canvas.drawLine(xs[i], top, xs[i], top + h, lineW);
    }
  };

  const drawRowCellsExceptSection = (top: number, r: TrainingDailyLogRow) => {
    canvas.setFont("regular", 8);

    canvas.textBox({ x: xs[1], y: top, w: col.date, h: rowH, text: r.date ?? "", align: "center", valign: "middle", fontSize: 8, padding: 2, lineGap: 1 });
    canvas.textBox({ x: xs[2], y: top, w: col.status, h: rowH, text: r.attendanceStatus ?? "", align: "center", valign: "middle", fontSize: 8, padding: 2, lineGap: 1 });
    canvas.textBox({ x: xs[3], y: top, w: col.time, h: rowH, text: r.trainingTime ?? "", align: "center", valign: "middle", fontSize: 8, padding: 2, lineGap: 1 });
    canvas.textBox({ x: xs[4], y: top, w: col.commute, h: rowH, text: r.commute ?? "", align: "center", valign: "middle", fontSize: 8, padding: 2, lineGap: 1 });
    canvas.textBox({ x: xs[5], y: top, w: col.flag, h: rowH, text: r.guidanceFlag ?? "", align: "center", valign: "middle", fontSize: 8, padding: 2, lineGap: 1 });

    canvas.textBox({ x: xs[6], y: top, w: col.task, h: rowH, text: r.task ?? "", align: "left", valign: "top", fontSize: 8, padding: 3, lineGap: 1 });
    canvas.textBox({ x: xs[7], y: top, w: col.level, h: rowH, text: r.taskLevelMeasured ?? "", align: "left", valign: "top", fontSize: 8, padding: 3, lineGap: 1 });
    canvas.textBox({ x: xs[8], y: top, w: col.eval, h: rowH, text: r.evalGuidance ?? "", align: "left", valign: "top", fontSize: 8, padding: 3, lineGap: 1 });
  };

  // =====================
  // 4) Signature block (원본: 3행 (서 명)) :contentReference[oaicite:4]{index=4}
  // =====================
  const drawSignature = () => {
    // 원본처럼 표 아래 충분한 공백 후 하단에 위치
    const baseY = pageH - margin - 60;

    canvas.setFont("regular", 8);

    const leftX = x0 + 10;
    const rightX = x0 + w0 - 85;

    const line = (label: string, yy: number) => {
      canvas.drawText({ x: leftX, y: yy, text: `${label} :`, w: 260, align: "left" });
      canvas.drawText({ x: rightX, y: yy, text: "(서  명)", w: 80, align: "left" });
    };

    line("(공단/위탁기관) 담당자", baseY);
    line("사업체담당자", baseY + 14);
    line("직무지도원", baseY + 28);
  };

  // =====================
  // Render
  // =====================
  // 1p
  drawTitle();
  drawMeta();
  drawTableHeader();

  const rows: TrainingDailyLogRow[] =
    data.rows.length > 0
      ? data.rows
      : [
          { section: "PRE", date: "" },
          { section: "PRE", date: "" },
          { section: "FIELD", date: "" },
          { section: "FIELD", date: "" },
        ];

  const runs = groupRuns(rows);

  for (const run of runs) {
    const secText = run.section === "PRE" ? "사전훈련" : "현장훈련";
    const secV = vstack(secText);

    let idx = 0;
    while (idx < run.rows.length) {
      // 페이지에 몇 행 들어가는지 계산
      const availableH = contentBottom - y;
      const fit = Math.max(0, Math.floor(availableH / rowH));
      if (fit <= 0) {
        // 2p~: 타이틀/메타 없이 표 헤더부터
        canvas.addPage();
        y = margin + 8;
        drawTableHeader();
        continue;
      }

      const take = Math.min(fit, run.rows.length - idx);
      const spanH = take * rowH;
      const spanTop = y;

      // 행들 그림 (섹션 제외)
      for (let i = 0; i < take; i++) {
        ensure(rowH, false);
        const top = y;
        drawRowFrame(top, rowH);
        drawRowCellsExceptSection(top, run.rows[idx + i]);
        y += rowH;
      }

      // 섹션 rowSpan 라벨(세로 적층) – 그룹 영역 중앙에 1회만
      canvas.setFont("bold", 8);
      canvas.textBox({
        x: xs[0],
        y: spanTop,
        w: col.section,
        h: spanH,
        text: secV,
        align: "center",
        valign: "middle",
        fontSize: 8,
        bold: true,
        padding: 1,
        lineGap: 1,
      });

      idx += take;
    }
  }

  // 마지막 하단 서명(원본은 마지막 페이지 하단) :contentReference[oaicite:5]{index=5}
  drawSignature();
}
