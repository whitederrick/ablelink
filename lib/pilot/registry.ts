// lib/pilot/registry.ts
// 파일럿 레지스트리 기록 — docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md §7
//
// ★왜 이 파일이 존재하는가
//  `Worker`·`Trainee`에는 `agencyId`가 없다(기관 연결이 각각 SiteAssignment·Site 경유).
//  배정을 먼저 지우면 그 Worker가 파일럿 것이었는지 판별할 수단이 사라진다.
//  이름 접두어·생성 날짜 추정은 금지다 — Prisma `startsWith`가 `_`를 LIKE 와일드카드로
//  넘겨 한글 기관명까지 매칭한 사고가 실제로 있었다.
//  → **생성 시점에 id를 적어두는 것 외에 방법이 없다.**
//
// ★기록 누락 = 영구 잔존. 그래서 모든 기록 함수는 **트랜잭션 클라이언트(tx)만** 받는다.
//  전역 `prisma`를 받지 않으므로 "트랜잭션 밖에서 기록"이 타입 단계에서 걸린다.

import type { Prisma, PilotResourceKind } from "@prisma/client";

/**
 * DB 자원 id를 레지스트리 키 문자열로 정규화한다.
 *
 * ★`@@unique([kind, resourceKey])`가 의미를 가지려면 형식이 하나여야 한다.
 *  BigInt의 10진 문자열만 쓴다(선행 0·공백·따옴표 금지).
 */
export function dbKey(id: bigint): string {
  return id.toString();
}

/**
 * Storage 객체 경로를 레지스트리 키로 정규화한다. `버킷명/객체경로` 형식.
 *
 * ★서명 URL을 그대로 넣지 않는다 — 같은 객체가 public/signed 두 형태로 중복 등록된다.
 */
export function storageKey(bucket: string, objectPath: string): string {
  return `${bucket}/${objectPath.replace(/^\/+/, "")}`;
}

/**
 * 레지스트리에 자원 1건을 기록한다. **반드시 자원을 만든 그 트랜잭션 안에서 호출한다.**
 *
 * ★DB 자원의 생성과 이 기록은 같은 DB 트랜잭션이어야 한다. 기록 없이 생성되면 영원히 못 지운다.
 * ★Storage는 예외다 — 외부 HTTP 호출이라 DB 트랜잭션에 묶을 수 없다(§10-1).
 *  업로드 성공 직후 등록하고, 등록이 실패하면 방금 올린 객체를 보상 삭제한 뒤 실패 처리한다.
 */
export async function recordResource(
  tx: Prisma.TransactionClient,
  pilotId: bigint,
  kind: PilotResourceKind,
  resourceKey: string,
): Promise<void> {
  await tx.pilotResource.create({ data: { pilotId, kind, resourceKey } });
}

/** DB 자원 기록 축약형 — id를 받아 `dbKey`로 정규화해 기록한다. */
export async function recordDbResource(
  tx: Prisma.TransactionClient,
  pilotId: bigint,
  kind: Exclude<PilotResourceKind, "STORAGE_OBJECT">,
  id: bigint,
): Promise<void> {
  await recordResource(tx, pilotId, kind, dbKey(id));
}

/** 레지스트리에 기록된 자원 id 목록(kind별). 초기화·검증에서 쓴다. */
export async function listResourceIds(
  tx: Prisma.TransactionClient,
  pilotId: bigint,
  kind: Exclude<PilotResourceKind, "STORAGE_OBJECT">,
): Promise<bigint[]> {
  const rows = await tx.pilotResource.findMany({
    where: { pilotId, kind },
    select: { resourceKey: true },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => BigInt(r.resourceKey));
}

/** kind별 기록 건수. 3단계 완료 검증(생성 건수 == 기록 건수)에 쓴다. */
export async function countByKind(
  tx: Prisma.TransactionClient,
  pilotId: bigint,
): Promise<Record<string, number>> {
  const rows = await tx.pilotResource.groupBy({
    by: ["kind"],
    where: { pilotId },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = r._count._all;
  return out;
}
