// lib/pdf/templates/ATTENDANCE_SHEET.ts
// ATTENDANCE_SHEET 템플릿 렌더링

import { PdfCanvas } from "../core/PdfCanvas";
export async function renderATTENDANCE_SHEET(opts: { canvas: PdfCanvas; payload: any }) {
  const { canvas } = opts;
  canvas.setFont("bold", 14);
  canvas.drawText({ x: canvas.margin, y: canvas.margin, w: canvas.pageWidth - canvas.margin * 2, text: "출근부(미구현)", align: "center" });
}
