// lib/prisma.ts

import { PrismaClient } from "@prisma/client";
import { makeAuditMiddleware } from "./audit";

// (선택) BigInt JSON 변환은 한 번만 등록되도록 가드
declare global {
  var __bigint_tojson_patched__: boolean | undefined;
  var __prisma__: PrismaClient | undefined;
  var __audit_mw_registered__: boolean | undefined;
}

if (!globalThis.__bigint_tojson_patched__) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
  globalThis.__bigint_tojson_patched__ = true;
}

// 개발 환경(핫리로드)에서 PrismaClient 중복 생성 방지
export const prisma =
  globalThis.__prisma__ ??
  new PrismaClient({
    // log: ["query", "info", "warn", "error"],
  });

// 감사로그 미들웨어 등록(1회) — 모든 쓰기를 audit_events에 자동 기록.
//  $use 미들웨어는 호출자 async 컨텍스트에서 실행 → AsyncLocalStorage(행위자) 정상 전파.
//  AuditEvent 모델 쓰기는 미들웨어가 스킵 → 무한루프 없음.
if (!globalThis.__audit_mw_registered__) {
  prisma.$use(makeAuditMiddleware(prisma));
  globalThis.__audit_mw_registered__ = true;
}

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma__ = prisma;
}
