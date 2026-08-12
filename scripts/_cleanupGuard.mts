// scripts/_cleanupGuard.mts
// 검증·스모크 스크립트의 테스트 데이터 정리를 "실패하면 드러나게" 만드는 공용 헬퍼.
//
// ★왜 필요한가 — 정리 삭제를 `.catch(() => {})`로 삼키면 실패해도 "정리 완료"가 찍히고
//  스크립트는 통과로 끝난다. 실제로 그 탓에 테스트 기관(__ps_test2_*)이 dev DB에 남아
//  **운영자 회차 생성 화면의 기관 드롭다운에 노출**됐다. 통과 결과와 별개로 데이터가 누적된다.
//
// 사용:
//   const c = new CleanupGuard();
//   await c.step("participant", () => prisma.pilotParticipant.deleteMany({ ... }));
//   ...
//   c.report();                       // 실패 목록 출력 + 실패 수 반환
//   await c.assertNoStale(prisma, ["__ps_"]);  // 이전 실행 잔여물까지 확인

export class CleanupGuard {
  private errors: string[] = [];

  /** 정리 단계 하나. 실패해도 나머지 단계를 계속 진행하되 사유를 모아 둔다. */
  async step(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.errors.push(`${label}: ${String((e as Error).message ?? e).split("\n")[0]}`);
    }
  }

  /** 정리 결과를 출력하고 실패 건수를 반환한다(0이면 성공). */
  report(): number {
    if (this.errors.length === 0) {
      console.log("  ✅ 테스트 데이터 정리 완료");
      return 0;
    }
    console.log(`  ❌ 정리 실패 ${this.errors.length}건 — dev DB에 테스트 데이터가 남았습니다:`);
    for (const m of this.errors) console.log(`     · ${m}`);
    return this.errors.length;
  }

  /**
   * 이전 실행이 중간에 죽어 남긴 잔여물을 확인한다.
   * 테스트 기관은 운영자 화면의 기관 목록에 그대로 보이므로 남으면 안 된다.
   */
  async assertNoStale(
    prisma: { agency: { findMany: (args: never) => Promise<{ id: bigint; name: string }[]> } },
    prefixes: string[],
  ): Promise<number> {
    // ★이름 패턴을 DB 필터로 쓰지 않고 전량 조회 후 JS에서 판정한다.
    //  Prisma의 startsWith 필터가 한글 기관명까지 잡아 실제 운영 기관이 목록에 섞이는 것을 겪었다.
    //  정리 스크립트가 이름 패턴으로 일괄 삭제하면 운영 데이터를 지울 수 있다 — 판정은 JS에서, 삭제는 id로.
    const all = await prisma.agency.findMany({ select: { id: true, name: true } } as never);
    const stale = all.filter((a) => prefixes.some((p) => a.name.startsWith(p)));
    for (const a of stale) {
      console.log(`  ❌ 이전 실행 잔여 테스트 기관: ${a.name} (#${a.id})`);
    }
    return stale.length;
  }
}
