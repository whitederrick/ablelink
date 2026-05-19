// lib/pdf/templates/COACH_CHECKLIST.ts
// COACH_CHECKLIST 템플릿 렌더링

import { PdfCanvas } from "../core/PdfCanvas";
export async function renderCOACH_CHECKLIST(opts: { canvas: PdfCanvas; payload: any }) {
  const { canvas } = opts;
  canvas.setFont("bold", 14);
  canvas.drawText({ x: canvas.margin, y: canvas.margin, w: canvas.pageWidth - canvas.margin * 2, text: "지도점검표(미구현)", align: "center" });
}
