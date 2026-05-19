// lib/pdf/templates/ADAPTATION_FINAL_EVAL.ts
// ADAPTATION_FINAL_EVAL 템플릿 렌더링

import { PdfCanvas } from "../core/PdfCanvas";
export async function renderADAPTATION_FINAL_EVAL(opts: { canvas: PdfCanvas; payload: any }) {
  const { canvas } = opts;
  canvas.setFont("bold", 14);
  canvas.drawText({ x: canvas.margin, y: canvas.margin, w: canvas.pageWidth - canvas.margin * 2, text: "적응지도 종합평가(미구현)", align: "center" });
}
