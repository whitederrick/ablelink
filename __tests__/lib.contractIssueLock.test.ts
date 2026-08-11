import { describe, it, expect } from "vitest";
import { contractIssueLockKey } from "@/lib/assignmentLock";

// 근로계약서 발행 락 키 파생 규칙(E-2, 2026-08-11)
//
// 이 락은 '최근 10초 PENDING 재조회(dedup) → create' 임계구역을 직렬화한다. 어떤 발행끼리 직렬화되는지가
// 전적으로 이 키에 달려 있으므로, 설계 결정을 테스트로 고정한다.
// ※ BigInt 리터럴(123n)은 이 프로젝트 tsconfig target(<ES2020)에서 쓸 수 없어 BigInt() 호출을 쓴다.

describe("contractIssueLockKey", () => {
  it("배정이 있으면 배정 단위 키", () => {
    expect(contractIssueLockKey({ assignmentId: BigInt(123), workerId: BigInt(999) })).toBe("a:123");
  });

  it("배정이 없으면(수동입력 계약) 워커 단위 키", () => {
    // assignmentId=null 발행은 dedup 스코프가 (workerId, assignmentId=null, 기간)이므로 워커로 잠근다.
    expect(contractIssueLockKey({ assignmentId: null, workerId: BigInt(456) })).toBe("w:456");
  });

  it("★배정 id와 워커 id가 같은 숫자여도 서로 다른 락", () => {
    // 접두사가 없으면 배정 7번 발행과 워커 7번 발행이 같은 락을 잡아 무관한 요청끼리 직렬화된다.
    const byAssignment = contractIssueLockKey({ assignmentId: BigInt(7), workerId: BigInt(1) });
    const byWorker = contractIssueLockKey({ assignmentId: null, workerId: BigInt(7) });
    expect(byAssignment).not.toBe(byWorker);
  });

  it("★같은 배정이면 계약 기간이 달라도 같은 락 — 키에 기간이 들어가지 않는다", () => {
    // 설계의 핵심. 키에 contractStart/End를 넣으면 기간이 하루라도 다른 두 발행이 서로 다른 락을 잡고
    // 동시에 통과하는데, 이 시스템의 계약 중복·충돌 의미론은 기간 '겹침'까지 포함한다(findTimeConflict).
    // → 그 배정의 모든 발행을 직렬화해야 겹침 검사가 경합하지 않는다.
    const a = contractIssueLockKey({ assignmentId: BigInt(42), workerId: BigInt(1) });
    const b = contractIssueLockKey({ assignmentId: BigInt(42), workerId: BigInt(1) });
    expect(a).toBe(b);
    // 워커가 달라도 배정이 같으면 같은 락(배정이 워커를 이미 함의)
    expect(contractIssueLockKey({ assignmentId: BigInt(42), workerId: BigInt(2) })).toBe(a);
  });

  it("서로 다른 배정은 병렬 진행(다른 락)", () => {
    expect(contractIssueLockKey({ assignmentId: BigInt(1), workerId: BigInt(1) }))
      .not.toBe(contractIssueLockKey({ assignmentId: BigInt(2), workerId: BigInt(1) }));
  });

  it("큰 id(2^53 초과)도 문자열로 안전하게 파생", () => {
    // hashtext(text)에 넘기므로 ::int 캐스팅 범위 문제가 없다(18차 P3와 동일 패턴).
    expect(contractIssueLockKey({ assignmentId: BigInt("9007199254740993"), workerId: BigInt(1) }))
      .toBe("a:9007199254740993");
  });
});
