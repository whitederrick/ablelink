// lib/csv.ts
// CSV 셀 이스케이프 단일 출처. 모든 CSV 내보내기는 이 함수를 사용한다.
//
// 두 가지를 함께 처리:
//  ① 수식 인젝션 방지 — 이름/일지 내용 등 텍스트가 = + - @ (또는 탭/CR)로 시작하면
//     Excel/Sheets가 수식으로 해석(정보 유출·명령 실행 위험). 작은따옴표로 무력화한다.
//     단, 숫자·좌표(음수 포함)는 정상 데이터이므로 예외.
//  ② 구분자/따옴표/개행 포함 시 표준 CSV 큰따옴표 감싸기(내부 " 는 "" 로).

export function escapeCsvCell(val: unknown): string {
  if (val == null) return "";
  let s = String(val);
  // 수식 인젝션 예외는 '전체가 숫자/좌표/전화번호'일 때만 — 과거엔 시작이 -숫자이기만 하면 예외라
  //  `-1+cmd|'/C calc'!A0` 같은 페이로드가 그대로 통과했다(G1). 시작만 검사하지 않고 셀 전체를 검사.
  //  · 숫자/좌표: -37.5, 12000  · 전화/국제번호: +821012345678, 010-1234-5678 (G2: + 전화가 손상되지 않도록 예외)
  const isSafeNumeric = /^-?\d+(\.\d+)?$/.test(s) || /^\+?\d[\d\s\-()]*$/.test(s);
  if (/^[=+\-@\t\r]/.test(s) && !isSafeNumeric) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** header + rows 를 BOM 포함 CSV 본문(\r\n)으로 직렬화. Excel 한글 정상 표시용 BOM. */
export function csvBody(header: (string | number)[], rows: (string | number)[][]): string {
  const lines = [header.map(escapeCsvCell).join(","), ...rows.map(r => r.map(escapeCsvCell).join(","))];
  return "﻿" + lines.join("\r\n");
}
