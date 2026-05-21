// lib/pdf/index.ts
// PDF 생성 단일 진입점 — Playwright + HCR 폰트 기반
import { htmlToPdfBuffer } from "./engine/playwright";

import { renderATTENDANCE_SHEET_HTML,   type AttendanceSheetPayload }    from "./templates-html/ATTENDANCE_SHEET";
import { renderTRAINING_DAILY_LOG_HTML, type TrainingDailyLogPayload }   from "./templates-html/TRAINING_DAILY_LOG";
import { renderADAPTATION_DAILY_LOG_HTML, type AdaptationDailyLogPayload } from "./templates-html/ADAPTATION_DAILY_LOG";
import { renderADAPTATION_FINAL_EVAL_HTML, type FinalEvalPayload }       from "./templates-html/ADAPTATION_FINAL_EVAL";
import { renderTRAINEE_FINAL_EVAL_HTML, type TraineeFinalEvalPayload }   from "./templates-html/TRAINEE_FINAL_EVAL";

export type DocumentType =
  | "ATTENDANCE_SHEET"
  | "TRAINING_DAILY_LOG"
  | "ADAPTATION_DAILY_LOG"
  | "ADAPTATION_FINAL_EVAL"
  | "TRAINEE_FINAL_EVAL";

export type {
  AttendanceSheetPayload,
  TrainingDailyLogPayload,
  AdaptationDailyLogPayload,
  FinalEvalPayload,
  TraineeFinalEvalPayload,
};

export async function renderPdfToBuffer(opts: {
  documentType: DocumentType;
  payload: any;
}): Promise<Buffer> {
  let html: string;

  switch (opts.documentType) {
    case "ATTENDANCE_SHEET":
      html = renderATTENDANCE_SHEET_HTML(opts.payload as AttendanceSheetPayload);
      break;
    case "TRAINING_DAILY_LOG":
      html = renderTRAINING_DAILY_LOG_HTML(opts.payload as TrainingDailyLogPayload);
      break;
    case "ADAPTATION_DAILY_LOG":
      html = renderADAPTATION_DAILY_LOG_HTML(opts.payload as AdaptationDailyLogPayload);
      break;
    case "ADAPTATION_FINAL_EVAL":
      html = renderADAPTATION_FINAL_EVAL_HTML(opts.payload as FinalEvalPayload);
      break;
    case "TRAINEE_FINAL_EVAL":
      html = renderTRAINEE_FINAL_EVAL_HTML(opts.payload as TraineeFinalEvalPayload);
      break;
    default:
      throw new Error(`Unsupported documentType: ${(opts as any).documentType}`);
  }

  // 여백은 각 템플릿의 @page CSS에서 직접 제어 → margin 0으로 통일
  return htmlToPdfBuffer({ html, margin: { top:"0", right:"0", bottom:"0", left:"0" } });
}
