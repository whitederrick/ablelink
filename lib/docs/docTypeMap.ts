// lib/docs/docTypeMap.ts
// PDF 렌더 docType(lib/pdf)과 Prisma DocumentType enum(DocumentRun)의 vocabulary가 달라 매핑 필요.
//  - 저장(DocumentRun.docType): PDF → Prisma
//  - 렌더(version sourceData → renderPdfToBuffer): Prisma → PDF

import type { DocumentType as PrismaDocType } from "@prisma/client";

// PDF docType → Prisma DocumentType
export const PDF_TO_PRISMA_DOCTYPE: Record<string, PrismaDocType> = {
  ATTENDANCE_SHEET:      "ATTENDANCE_SHEET",
  TRAINING_DAILY_LOG:    "TRAINING_DAILY_LOG",
  TRAINEE_FINAL_EVAL:    "TRAINEE_COMPREHENSIVE_EVAL",
  ADAPTATION_DAILY_LOG:  "POST_EMPLOY_ADAPT_LOG",
  ADAPTATION_FINAL_EVAL: "ADAPTATION_COMPREHENSIVE_EVAL",
};

// Prisma DocumentType → PDF docType(렌더용)
export const PRISMA_TO_PDF_DOCTYPE: Record<string, string> = {
  ATTENDANCE_SHEET:              "ATTENDANCE_SHEET",
  TRAINING_DAILY_LOG:            "TRAINING_DAILY_LOG",
  TRAINEE_COMPREHENSIVE_EVAL:    "TRAINEE_FINAL_EVAL",
  POST_EMPLOY_ADAPT_LOG:         "ADAPTATION_DAILY_LOG",
  ADAPTATION_COMPREHENSIVE_EVAL: "ADAPTATION_FINAL_EVAL",
};
