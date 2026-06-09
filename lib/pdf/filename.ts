// lib/pdf/filename.ts
// PDF 파일명 단일 규칙 — preview/generate가 공통 사용.
// 훈련생별 문서는 파일명에 훈련생명을 포함해 중복 방지.
import type { DocumentType } from "./index";

const DOC_FILE_LABEL: Record<DocumentType, string> = {
  ATTENDANCE_SHEET:      "출근부",
  TRAINING_DAILY_LOG:    "지원고용훈련일지",
  TRAINEE_FINAL_EVAL:    "지원고용훈련생종합평가",
  ADAPTATION_DAILY_LOG:  "취업후적응지도일지",
  ADAPTATION_FINAL_EVAL: "취업후적응지도종합평가",
  PAYSLIP:               "임금명세서",
  EMPLOYMENT_CONTRACT:   "근로계약서",
};

// 훈련생 단위로 발급되는 문서(출근부 제외) — 파일명에 훈련생명 필수 포함
const TRAINEE_DOCS = new Set<DocumentType>([
  "TRAINING_DAILY_LOG",
  "TRAINEE_FINAL_EVAL",
  "ADAPTATION_DAILY_LOG",
  "ADAPTATION_FINAL_EVAL",
]);

function sanitize(part?: string | null): string {
  // 파일명에 부적합한 문자 제거(경로구분자 등). 공백은 유지.
  return (part ?? "").replace(/[\\/:*?"<>|]/g, "").trim();
}

/** 예: 훈련일지_홍길동_2026-06-01_2026-06-30.pdf / 출근부_OO마트_2026-06-01_2026-06-30.pdf */
export function buildDocFileName(
  docType: DocumentType,
  opts: { traineeName?: string | null; companyName?: string | null; start: string; end: string },
): string {
  const label = DOC_FILE_LABEL[docType] ?? "문서";
  const who = TRAINEE_DOCS.has(docType)
    ? (sanitize(opts.traineeName) || "훈련생")
    : sanitize(opts.companyName);
  const parts = [label, who, opts.start, opts.end].filter(Boolean);
  return `${parts.join("_")}.pdf`;
}

/**
 * Content-Disposition 헤더 값. 한글 파일명은 RFC5987(filename*) + ASCII 폴백.
 * disposition: "inline"(화면 표시) 또는 "attachment"(다운로드).
 */
export function contentDisposition(fileName: string, disposition: "inline" | "attachment" = "inline"): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
