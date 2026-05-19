// lib/pdf/templates/ADAPTATION_DAILY_LOG.ts
// This is a placeholder implementation for the ADAPTATION_FINAL_EVAL template.
// You can expand this function to include the actual rendering logic as needed.

import { PdfCanvas } from "../core/PdfCanvas";
export async function renderADAPTATION_DAILY_LOG(opts: { canvas: PdfCanvas; payload: any }) {
  const { canvas } = opts;
  canvas.setFont("bold", 14);
  canvas.drawText({ x: canvas.margin, y: canvas.margin, w: canvas.pageWidth - canvas.margin * 2, text: "적응지도 일지(미구현)", align: "center" });
}
