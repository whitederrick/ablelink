// admlink-admin/lib/time.ts
// KST(한국 표준시) 관련 유틸리티 함수들

// "YYYY-MM-DD"가 형식 + 달력상 실존 날짜인지 검증(왕복검증).
//  ★정규식(/^\d{4}-\d{2}-\d{2}$/)만으로는 2026-02-30·2026-04-31이 통과하고, Date.parse는
//   이를 3/2·5/1로 '롤오버'시켜 통과시킨다(NaN은 월>12·일>31뿐). 파싱 결과를 다시 문자열로 만들어
//   입력과 일치할 때만 실존 날짜로 인정한다. 저장 전 모든 날짜 입력 검증의 단일 소스.
export function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function getKstDateString(date = new Date()) {
  // KST(UTC+9) 기준으로 YYYY-MM-DD 생성
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
}

// KST 기준 시:분:초 문자열(2자리). 렌더 위치 무관 — 서버(UTC)/클라(로컬) 어디서 계산해도
//  동일한 KST 값을 출력한다(한국은 서머타임 없이 항상 UTC+9라 고정 오프셋으로 안전).
//  → SSR 시계가 서버 타임존(UTC)으로 렌더돼 직접 접속 시 9시간 어긋나던 문제 근본 차단.
export function getKstHms(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    hh: String(kst.getUTCHours()).padStart(2, "0"),
    mm: String(kst.getUTCMinutes()).padStart(2, "0"),
    ss: String(kst.getUTCSeconds()).padStart(2, "0"),
  };
}