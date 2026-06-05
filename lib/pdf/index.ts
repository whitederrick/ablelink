// lib/pdf/index.ts
// PDF 생성 단일 진입점 — pdfkit 기반(브라우저 불필요, 서버리스 안전).
// (구) Playwright/Chromium 엔진은 Vercel 서버리스에서 동작 불가 → pdfkitRenderer로 대체.
import { renderPdfKit } from "./pdfkitRenderer";

// payload 타입만 사용 — HTML 렌더 함수(구 playwright 엔진용)는 미사용이므로 import 안 함.
import { type AttendanceSheetPayload }    from "./templates-html/ATTENDANCE_SHEET";
import { type TrainingDailyLogPayload }   from "./templates-html/TRAINING_DAILY_LOG";
import { type AdaptationDailyLogPayload } from "./templates-html/ADAPTATION_DAILY_LOG";
import { type FinalEvalPayload }          from "./templates-html/ADAPTATION_FINAL_EVAL";
import { type TraineeFinalEvalPayload }   from "./templates-html/TRAINEE_FINAL_EVAL";

export type DocumentType =
  | "ATTENDANCE_SHEET"
  | "TRAINING_DAILY_LOG"
  | "ADAPTATION_DAILY_LOG"
  | "ADAPTATION_FINAL_EVAL"
  | "TRAINEE_FINAL_EVAL";

const DOC_TYPE_MAP: Record<string, DocumentType> = {
  "attendance-sheet":      "ATTENDANCE_SHEET",
  "training-daily-log":    "TRAINING_DAILY_LOG",
  "adaptation-daily-log":  "ADAPTATION_DAILY_LOG",
  "trainee-final-eval":    "TRAINEE_FINAL_EVAL",
  "adaptation-final-eval": "ADAPTATION_FINAL_EVAL",
};

/** kebab-case 또는 SCREAMING_SNAKE_CASE 모두 허용 */
export function normalizeDocType(raw: string | null | undefined): DocumentType | null {
  if (!raw) return null;
  if (DOC_TYPE_MAP[raw]) return DOC_TYPE_MAP[raw];
  const upper = raw as DocumentType;
  if (Object.values(DOC_TYPE_MAP).includes(upper)) return upper;
  return null;
}

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
  // pdfkit 렌더러로 위임(브라우저 불필요). payload 형태는 기존과 동일.
  return renderPdfKit(opts.documentType, opts.payload);
}
