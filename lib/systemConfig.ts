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
    key: "DASHBOARD_TICKER_DURATION_SEC",
    label: "대시보드 티커 속도(초/바퀴)",
    description: "위탁기관 대시보드 상단 소식 티커가 한 바퀴 흐르는 시간(초). 작을수록 빠름.",
    type: "number", default: "32", min: 8, max: 120,
  },
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
  {
    key: "TRIAL_DAYS",
    label: "무료 체험 기간(일)",
    description: "FREE→TRIAL 전환 시 부여하는 무료 체험 일수.",
    type: "number", default: "15", min: 1, max: 90,
  },
  {
    key: "LATE_THRESHOLD_MIN",
    label: "지각 판정 임계(분)",
    description: "실제 출근이 표준 출근시각보다 이만큼 이상 늦으면 근태 이상(지각)으로 표시.",
    type: "number", default: "15", min: 1, max: 120,
  },
  // 직무지도원 홈 출퇴근 카드 격려 문구(상태별). 운영자가 자유 편집.
  {
    key: "HOME_MSG_BEFORE",
    label: "홈 문구 — 출근 전",
    description: "직무지도원 홈 출퇴근 카드에서 '출근 전' 상태에 표시되는 격려 문구.",
    type: "string", default: "오늘도 좋은 하루 되세요",
  },
  {
    key: "HOME_MSG_WORKING",
    label: "홈 문구 — 근무 중",
    description: "직무지도원 홈 출퇴근 카드에서 '근무 중' 상태에 표시되는 격려 문구.",
    type: "string", default: "열심히 일하고 계시네요!",
  },
  {
    key: "HOME_MSG_DONE",
    label: "홈 문구 — 마감 중(퇴근 후)",
    description: "직무지도원 홈 출퇴근 카드에서 퇴근 후 '마감 중' 상태에 표시되는 문구.",
    type: "string", default: "수고하셨습니다",
  },
  {
    key: "HOME_MSG_CLOSED",
    label: "홈 문구 — 퇴근 완료",
    description: "직무지도원 홈 출퇴근 카드에서 '퇴근 완료' 상태에 표시되는 문구.",
    type: "string", default: "오늘 하루도 고생하셨습니다",
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
