// lib/prisma.ts

import { PrismaClient } from "@prisma/client";

// (선택) BigInt JSON 변환은 한 번만 등록되도록 가드
declare global {
  // eslint-disable-next-line no-var
  var __bigint_tojson_patched__: boolean | undefined;
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
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
    // 필요 시 로그 옵션
    // log: ["query", "info", "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma__ = prisma;
}
