// lib/prisma.ts

import { PrismaClient } from "@prisma/client";
import { makeAuditExtension } from "./audit";

// (선택) BigInt JSON 변환은 한 번만 등록되도록 가드
declare global {
  var __bigint_tojson_patched__: boolean | undefined;
  var __prisma_base__: PrismaClient | undefined;
  var __prisma_ext__: PrismaClient | undefined;
}

if (!globalThis.__bigint_tojson_patched__) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
  globalThis.__bigint_tojson_patched__ = true;
}

// 비확장 base 클라이언트(감사 기록 전용 — 확장을 다시 타지 않아 재귀 방지) + 감사 확장을 적용한 export 클라이언트.
const base =
  globalThis.__prisma_base__ ??
  new PrismaClient({
    // log: ["query", "info", "warn", "error"],
  });

// 감사로그 자동 기록 확장 적용. 기존 코드는 prisma를 PrismaClient로 사용하므로 캐스팅(런타임 메서드 동일).
export const prisma = (globalThis.__prisma_ext__ ??
  base.$extends(makeAuditExtension(base))) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma_base__ = base;
  globalThis.__prisma_ext__ = prisma;
}
