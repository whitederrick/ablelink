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
// 공고(RecruitPost) 락 네임스페이스 — 마켓 신청 동시 수락 시 '아직 없는 현장'의 최초 생성 경합을 직렬화.
//  (site 락은 siteId를 알아야 잡는데, find-or-create 이전엔 siteId가 없어 못 잡음 → postId로 잠근다.)
const POST_LOCK_NS = 2;
// 근로계약서 발행 락 네임스페이스(E-2) — 같은 배정에 대한 동시 발행을 직렬화.
const CONTRACT_ISSUE_LOCK_NS = 3;
// 훈련생 단위 락 네임스페이스(D-1) — 같은 훈련생의 재적(placement)·담당(supervision) 기간 겹침 검사를 직렬화.
const TRAINEE_LOCK_NS = 4;
// 파일럿 회차 단위 락 네임스페이스 — 회차 상태 전이와 초대 발급·수락·연결을 한 축에서 직렬화.
const PILOT_SESSION_LOCK_NS = 5;

/**
 * 근로계약서 발행 임계구역 락(E-2). 발행은 '최근 10초 PENDING 재조회(dedup) → create' 사이에 직렬화가
 * 없어, ms 단위 동시 요청 둘이 모두 dedup을 통과해 중복 계약 2건 + 카카오 알림톡 2건(실비용·법적 문서
 * 중복 요청)이 새어나갈 수 있었다. 기존 10초 dedup은 순차 더블클릭만 막는 best-effort였다.
 *
 * ★락 키는 배정 단위로 거칠게 잡는다. 기간(contractStart/End)까지 키에 넣으면 기간이 하루라도 다른 두
 *  발행이 서로 다른 락을 잡고 동시에 통과하는데, 이 시스템의 계약 중복·충돌 의미론은 기간 '겹침'까지
 *  포함하므로(findTimeConflict) 그 배정의 모든 발행을 직렬화하는 편이 안전하고 단순하다. 계약 발행은
 *  저빈도라 과-잠금 비용은 사실상 0이다.
 *
 * 배정 없이 발행하는 수동입력 계약(assignmentId=null)은 dedup 스코프가 (workerId, assignmentId=null,
 * 기간)이므로 워커 단위로 잠근다. 두 키는 접두사("a:"/"w:")로 구분해 id 값이 우연히 겹쳐도 서로 다른
 * 락이 된다(해시 충돌은 잠깐 과-잠금될 뿐 정합성엔 안전 — site 락과 동일한 hashtext 패턴).
 *
 * ※교착 안전: 이 트랜잭션은 NS=3 락 하나만 잡고 워커 락(단일키)이나 현장 락(NS=1)을 잡지 않으므로,
 *  기존 '[site|post] → worker' 획득 순서와 순환대기를 만들 수 없다. 임계구역은 재조회+create만 —
 *  감사로그·알림톡(외부 통신)은 반드시 락 밖에서 수행한다.
 */
export function contractIssueLockKey(key: { assignmentId: bigint | null; workerId: bigint }): string {
  return key.assignmentId != null ? `a:${key.assignmentId}` : `w:${key.workerId}`;
}

export async function withContractIssueLock<T>(
  key: { assignmentId: bigint | null; workerId: bigint },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const lockKey = contractIssueLockKey(key);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CONTRACT_ISSUE_LOCK_NS}::int, hashtext(${lockKey}))`;
    return fn(tx);
  });
}

/**
 * 훈련생 단위 임계구역 락(D-1). 같은 훈련생에 대한 재적·담당 기간 겹침 검사와 생성 사이에 직렬화가 없으면,
 * ms 단위 동시 요청 둘이 모두 "겹치는 기간 없음"을 통과해 한 훈련생이 같은 시점에 두 직무지도원에게
 * 담당되는 상태가 새어나간다. SiteAssignment와 마찬가지로 날짜범위 배타 제약을 걸 수 없으므로
 * (DB exclusion constraint는 Prisma drift·운영 복잡성 때문에 1차 필수조건에서 제외) advisory 락으로 막는다.
 *
 * ★교착 안전 — 전역 획득 순서는 `pilotSession → [site|post] → worker → trainee`다.
 *  이 락(NS=4)은 그 순서의 맨 끝이므로, 앞 순서 락을 이미 잡은 트랜잭션이 추가로 잡아도 순환대기가 없다.
 *  반대로 이 락을 잡은 뒤에 회차·현장·워커 락을 잡아서는 안 된다.
 *
 * 임계구역은 짧게(겹침 재조회 + create 1건) 유지하고, 감사로그·알림 등 부수효과는 락 밖에서 수행한다.
 */
export async function withTraineeLock<T>(
  traineeId: bigint,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await acquireTraineeLock(tx, traineeId);
    return fn(tx);
  });
}

// ─────────────────────────────────────────────────────────────────
// ★전역 락 획득 순서 (교착 방지의 근거 — 새 경로는 반드시 이 순서를 지킨다)
//
//     pilotSession(NS=5) → [site(NS=1) | post(NS=2)] → worker(단일키) → trainee(NS=4)
//
// 앞 순서를 이미 잡은 트랜잭션이 뒤 순서를 추가로 잡는 것은 안전하다.
// 반대 방향(뒤를 잡은 뒤 앞을 잡는 것)은 순환대기를 만든다.
// 계약 발행 락(NS=3)은 이 사슬의 어느 것도 함께 잡지 않아 독립적이다.
// ─────────────────────────────────────────────────────────────────

/**
 * 이미 열려 있는 트랜잭션에서 파일럿 회차 락을 획득한다(NS=5, 순서 **1번째**).
 *
 * ★회차 상태 전이(READY→ACTIVE 등)와 초대 발급·수락·연결·참여 취소를 **같은 축**에서 직렬화한다.
 *  각 경로가 회차 상태를 읽기만 하면, "연결 진행 중에 ACTIVE 전환"처럼 검사와 전이가
 *  겹쳐 창구 규칙이 무너진다. 상태를 읽는 쪽과 바꾸는 쪽이 같은 락을 잡아야 한다.
 */
export async function acquirePilotSessionLock(
  tx: Prisma.TransactionClient,
  pilotSessionId: bigint,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PILOT_SESSION_LOCK_NS}::int, hashtext(${pilotSessionId.toString()}))`;
}

/**
 * 전역 활성화 락(NS=5의 고정 키). **서로 다른 회차**를 동시에 ACTIVE로 만들려는 경합을 직렬화한다.
 *
 * ★회차 락만으로는 부족하다 — 회차 A와 B는 서로 다른 키를 잡으므로 직렬화되지 않는다.
 *  둘 다 "다른 ACTIVE 없음"을 관측하고 통과하면 partial unique index가 뒤늦게 터져
 *  409가 아니라 Prisma 오류(500)가 된다. 전이 경로가 이 락을 함께 잡아 먼저 줄을 세운다.
 *
 * 획득 순서는 **회차 락 다음**이다(항상 마지막에 잡으므로 순환대기가 없다).
 */
export async function acquirePilotActivationLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PILOT_SESSION_LOCK_NS}::int, hashtext(${"__pilot_global_activation__"}))`;
}

/**
 * 이미 열려 있는 트랜잭션에서 현장 락만 획득한다(NS=1, 순서 **2번째**).
 * 여러 자원을 한 트랜잭션에서 만드는 경로가 정원검사 TOCTOU를 막으려면 이 락 안에서
 * checkSiteCapacity → 배정 생성을 해야 한다.
 */
export async function acquireSiteLock(
  tx: Prisma.TransactionClient,
  siteId: bigint,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SITE_LOCK_NS}::int, hashtext(${siteId.toString()}))`;
}

/**
 * 이미 열려 있는 트랜잭션에서 워커 락만 획득한다(단일키, 순서 **3번째**).
 * 같은 워커에 대한 배정 생성·승격을 직렬화한다 — 겹침 검사와 생성 사이에 직렬화가 없으면
 * 동시 요청 둘이 모두 통과해 이중배정이 새어나간다.
 */
export async function acquireWorkerLock(
  tx: Prisma.TransactionClient,
  workerId: bigint,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${workerId}::bigint)`;
}

/**
 * 이미 열려 있는 트랜잭션에서 훈련생 락만 획득한다(NS=4, 순서 **4번째=맨 끝**).
 * 여러 자원을 한 트랜잭션에서 만드는 경로(예: 초대 수락 = Worker + 배정 + 담당 관계)는
 * 자체 트랜잭션을 새로 열 수 없으므로 이 함수로 같은 tx 위에서 락을 잡는다.
 */
export async function acquireTraineeLock(
  tx: Prisma.TransactionClient,
  traineeId: bigint,
): Promise<void> {
  // ★BigInt를 ::int로 캐스팅하면 2^31 초과 id에서 'integer out of range'로 실패한다(18차 P3와 동일).
  //  hashtext로 32비트 키를 결정적으로 파생한다. 해시 충돌은 서로 다른 두 훈련생이 잠깐 직렬화될 뿐이라 안전.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRAINEE_LOCK_NS}::int, hashtext(${traineeId.toString()}))`;
}

/**
 * 공고 락 + 워커 락(post→worker, 무교착). 마켓 신청 수락에서 신규 현장 find-or-create를 postId로 직렬화한다.
 * 임계구역 안에서 recruitPost.siteId를 재조회하면, 동시 수락 중 먼저 커밋한 쪽이 만든 현장을 재사용(중복 생성 방지).
 * 단일 tx는 site 락(NS=1)과 post 락(NS=2)을 동시에 잡지 않으므로([site|post]→worker 순서 일관) 교착 불가.
 */
export async function withPostAndWorkerLock<T>(
  postId: bigint,
  workerId: bigint,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POST_LOCK_NS}::int, hashtext(${postId.toString()}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${workerId}::bigint)`;
    return fn(tx);
  });
}

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
