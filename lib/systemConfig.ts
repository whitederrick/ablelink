// lib/systemConfig.ts
// 운영자 조정 시스템 파라미터 — 하드코딩 지양. DB(SystemConfig) 우선, 없으면 기본값.
// 새 설정값은 CONFIG_REGISTRY에 추가하면 운영자 설정 화면(admin/settings)에 자동 노출된다.

import { prisma } from "@/lib/prisma";

export type ConfigType = "number" | "string";

export interface ConfigSpec {
  key: string;
  label: string;
  description: string;
  type: ConfigType;
  default: string;
  min?: number;
  max?: number;
}

export const CONFIG_REGISTRY: ConfigSpec[] = [
  {
    key: "AI_BATCH_MONTHLY_LIMIT",
    label: "AI 음성 일괄 등록 월 횟수",
    description: "직무지도원 1인당 월 AI 일괄 일지 생성 허용 횟수.",
    type: "number", default: "2", min: 0, max: 31,
  },
  {
    key: "AUTO_FINALIZE_MINUTES",
    label: "출근부 자동 마감(분)",
    description: "퇴근 처리 후 N분 경과 시 출근부 자동 최종 확정.",
    type: "number", default: "180", min: 10, max: 1440,
  },
  {
    key: "DOC_MAX_VERSIONS_PER_RUN",
    label: "문서 버전 보존 수",
    description: "문서 제출 run당 보존하는 최근 버전 개수(초과분 자동 정리).",
    type: "number", default: "20", min: 5, max: 100,
  },
];

const SPEC_BY_KEY = Object.fromEntries(CONFIG_REGISTRY.map(s => [s.key, s]));

// 프로세스 캐시(60초 TTL) — 매 요청 DB 조회 방지.
let cache: Record<string, string> | null = null;
let cacheAt = 0;
const TTL = 60_000;

async function loadAll(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache && now - cacheAt < TTL) return cache;
  try {
    const rows = await prisma.systemConfig.findMany();
    cache = Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch {
    cache = {};
  }
  cacheAt = now;
  return cache;
}

export function invalidateConfigCache() { cache = null; }

/** 문자열 설정값 조회(없으면 registry 기본값). */
export async function getConfig(key: string): Promise<string> {
  const all = await loadAll();
  return all[key] ?? SPEC_BY_KEY[key]?.default ?? "";
}

/** 숫자 설정값 조회. */
export async function getConfigNumber(key: string): Promise<number> {
  const v = await getConfig(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : Number(SPEC_BY_KEY[key]?.default ?? 0);
}

/** 운영자 편집용: registry + 현재값 목록. */
export async function listConfigs(): Promise<(ConfigSpec & { value: string })[]> {
  const all = await loadAll();
  return CONFIG_REGISTRY.map(s => ({ ...s, value: all[s.key] ?? s.default }));
}
