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
  // 수식 인젝션 예외는 '셀 전체가 순수 숫자/좌표'일 때만 — 과거엔 시작이 -숫자이기만 하면 예외라
  //  `-1+cmd|'/C calc'!A0` 같은 페이로드가 그대로 통과했다(G1). 시작만 검사하지 않고 셀 전체를 검사.
  //  · 숫자/좌표(-37.5, 12000)는 Excel에서 정상 숫자로 표시되므로 예외(이스케이프 안 함).
  //  · R2-7 결정(2026-07-06, 사용자 확정): '+' 시작 국제전화(+8210…)는 **이스케이프한다**.
  //    이 CSV들은 사람이 Excel로 여는 게 기본 — 예외로 두면 Excel이 '+'를 수식으로 먹어 전화번호가 깨진다.
  //    작은따옴표('+8210…) 접두는 Excel 화면엔 안 보이고 텍스트로 정상 표시된다(프로그램 import 시엔 앞 ' 스트립).
  const isSafeNumeric = /^-?\d+(\.\d+)?$/.test(s);
  if (/^[=+\-@\t\r]/.test(s) && !isSafeNumeric) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** header + rows 를 BOM 포함 CSV 본문(\r\n)으로 직렬화. Excel 한글 정상 표시용 BOM. */
export function csvBody(header: (string | number)[], rows: (string | number)[][]): string {
  const lines = [header.map(escapeCsvCell).join(","), ...rows.map(r => r.map(escapeCsvCell).join(","))];
  return "﻿" + lines.join("\r\n");
}
