// lib/assignmentLock.ts
// 워커 단위 배정 상호배제 락 — 이중배정 TOCTOU 방어(P1-4/P1-5).
//
// 배정 생성·승격 경로(직접배정·respond·finalize·계약서명 write-back·매칭 offers·recruit-applications)는
// "겹침/중복 검사 → 승격/생성" 사이에 직렬화가 없어, 같은 워커에 대한 동시 요청 둘이 모두 검사를
// 통과해 이중배정이 새어나갈 수 있다. SiteAssignment에는 날짜범위 겹침을 표현하는 배타 제약을 걸 수
// 없으므로(범위+반나절 슬롯 조합), 워커 id 기준 PostgreSQL advisory 트랜잭션 락으로 직렬화한다.
//
//  · pg_advisory_xact_lock(bigint)은 트랜잭션 커밋/롤백 시 자동 해제 → 세션 락과 달리
//    pgbouncer transaction 풀링(현재 DATABASE_URL pgbouncer=true)과 호환된다.
//  · 같은 workerId의 배정 변경만 직렬화하고, 다른 워커끼리는 병렬로 진행한다.
//  · 임계구역은 짧게(검사 몇 개 + 승격 1건) 유지하고, 알림/감사 등 부수효과는 락 밖에서 수행한다.

import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

export async function withWorkerAssignmentLock<T>(
  workerId: bigint,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // 첫 구문에서 워커 락 획득 — 이 트랜잭션이 끝날 때까지 같은 workerId의 다른 락 획득은 대기한다.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${workerId}::bigint)`;
    return fn(tx);
  });
}

/**
 * 여러 워커를 한 트랜잭션에서 잠근다(예: finalize가 여러 후보를 동시에 승격). 락은 workerId 오름차순으로
 * 획득해 두 요청의 워커 집합이 겹칠 때 교착(deadlock)을 방지한다(항상 같은 순서로 잠금 → 순환대기 불가).
 */
export async function withWorkersAssignmentLock<T>(
  workerIds: bigint[],
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const ordered = orderWorkerIds(workerIds);
  return prisma.$transaction(async (tx) => {
    for (const wid of ordered) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${wid}::bigint)`;
    }
    return fn(tx);
  });
}

function orderWorkerIds(workerIds: bigint[]): bigint[] {
  return [...new Set(workerIds.map((w) => w.toString()))]
    .map((s) => BigInt(s))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// 현장 단위 락 네임스페이스(두-키 advisory 락). PostgreSQL은 단일키 락(pg_advisory_xact_lock(bigint))과
//  두-키 락(pg_advisory_xact_lock(int,int))을 서로 다른 lock space로 관리 → 현장 락은 workerId 단일키 락과
//  절대 충돌하지 않는다.
const SITE_LOCK_NS = 1;

/**
 * 현장 락 + 여러 워커 락을 한 트랜잭션에서 획득(finalize 정원검사 TOCTOU + 이중배정 동시 방어, #4/P1-5).
 * 획득 순서 = '현장 → 워커(오름차순)'로 항상 고정한다. finalize만 두 락을 잡고 다른 경로(respond·직접배정 등)는
 * 워커 락만 잡으므로, 순서 역전이 없어 교착이 불가능하다. 임계구역 안에서 filledCnt 재조회→가드→승격을
 * 원자적으로 수행하면, 같은 현장에 다른 워커들로 동시 finalize가 각자 정원검사를 통과해 정원을 초과하는
 * 경쟁을 막는다.
 */
export async function withSiteAndWorkersAssignmentLock<T>(
  siteId: bigint,
  workerIds: bigint[],
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const ordered = orderWorkerIds(workerIds);
  return prisma.$transaction(async (tx) => {
    // ★18차(P3): siteId(BigInt)를 ::int로 캐스팅하면 2^31 초과 id에서 'integer out of range'로 트랜잭션이
    //  실패한다. hashtext(int4 반환)로 32비트 키를 결정적으로 파생한다(worker/docs/submit 락과 동일 패턴).
    //  드문 해시 충돌은 서로 다른 두 현장이 같은 락을 공유해 잠깐 직렬화될 뿐(과-잠금)이라 정합성은 안전.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SITE_LOCK_NS}::int, hashtext(${siteId.toString()}))`;
    for (const wid of ordered) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${wid}::bigint)`;
    }
    return fn(tx);
  });
}
