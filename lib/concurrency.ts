// lib/concurrency.ts
// 순서 보존 + 동시성 상한 map. PDF 렌더처럼 무거운 작업을 요청 안에서 병렬화하되,
// DB 커넥션/메모리 폭주를 막기 위해 동시 실행 수를 제한한다. 결과는 입력 순서대로 반환.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
