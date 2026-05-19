// lib/pdf/index.ts
import { htmlToPdfBuffer } from "./engine/playwright";
import { renderTRAINING_DAILY_LOG_HTML, type TrainingDailyLogPayload } from "./templates-html/TRAINING_DAILY_LOG";

export type DocumentType =
  | "TRAINING_DAILY_LOG"
  | "ATTENDANCE_SHEET"
  | "ADAPTATION_DAILY_LOG"
  | "ADAPTATION_FINAL_EVAL"
  | "COACH_CHECKLIST"
  | "TRAINEE_FINAL_EVAL";

export async function renderPdfToBuffer(opts: {
  documentType: DocumentType;
  payload: any;
}): Promise<Buffer> {
  switch (opts.documentType) {
    case "TRAINING_DAILY_LOG": {
      const html = renderTRAINING_DAILY_LOG_HTML(opts.payload as TrainingDailyLogPayload);
      return await htmlToPdfBuffer({
        html,
        margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      });
    }

    // 다른 서식은 템플릿 추가 시 여기만 확장
    default:
      throw new Error(`Unsupported documentType: ${opts.documentType}`);
  }
}
