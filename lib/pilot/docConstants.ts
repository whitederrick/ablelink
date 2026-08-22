// lib/pilot/docConstants.ts
// 파일럿 문서 상수 — 의존성 없는 순수 값만 둔다.
//
// ★`lib/pilot/docs.ts` 와 분리한 이유: docs.ts 는 prisma·supabase 등 서버 전용 모듈을 끌어온다.
//  검증 스윕(`scripts/verify-pilot-pdf.mts`)은 상수만 필요하므로 그 무게를 지면 안 된다.

/** 파일럿이 제공하는 문서 3종. 종합평가 등은 제공하지 않는다(§1 범위 — 일지 작성 체험). */
export const PILOT_DOC_TYPES = ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG", "ADAPTATION_DAILY_LOG"] as const;
export type PilotDocType = (typeof PILOT_DOC_TYPES)[number];

/**
 * 파일럿 배정의 서비스 단계. 운영 `SiteAssignment.serviceStep` 과 같은 값을 쓴다.
 * ★파일럿은 2종만 — `PRE_TRAINING`(사전훈련)은 별도 전환일 개념이 얽혀 범위 밖이다.
 */
export const PILOT_SERVICE_STEPS = ["FIELD_TRAINING", "ADAPTATION"] as const;
export type PilotServiceStep = (typeof PILOT_SERVICE_STEPS)[number];

export const PILOT_SERVICE_STEP_LABEL: Record<PilotServiceStep, string> = {
  FIELD_TRAINING: "지원고용 훈련",
  ADAPTATION: "취업 후 적응지도",
};

/**
 * 단계별 문서 세트 — **운영 `/worker/docs`(page.tsx:56-57)와 같은 규칙**이다.
 * 운영은 종합평가까지 포함하지만 파일럿은 제공하지 않으므로 그만큼만 뺐다.
 *
 * ★이 구분이 없으면 적응지도 파일럿인데 훈련일지가 뽑히고, 더 나쁘게는 작성한 일지가
 *  `trainingType` 축이 어긋나 적응지도일지 PDF에 **한 건도 안 나온다**
 *  (`serviceStep` → `lib/serviceStep.serviceStepToTrainingType` → 일지 조회 조건).
 */
export const PILOT_DOCS_BY_STEP: Record<PilotServiceStep, readonly PilotDocType[]> = {
  FIELD_TRAINING: ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG"],
  ADAPTATION:     ["ATTENDANCE_SHEET", "ADAPTATION_DAILY_LOG"],
};

/** 배정의 serviceStep(운영 enum 문자열)을 파일럿 단계로 정규화. 모르는 값은 지원고용으로. */
export function toPilotServiceStep(v: unknown): PilotServiceStep {
  return String(v ?? "") === "ADAPTATION" ? "ADAPTATION" : "FIELD_TRAINING";
}

/**
 * 위탁기관 담당자 이름 자리에 넣는 **수기 기입 공간**.
 *
 * ★★**보이는 표시를 넣지 않는다 — 공백만 둔다**(사용자 확정 2026-08-13).
 *  같은 서명 블록의 다른 성명 칸(사업체담당자·직무지도원)에는 밑줄이 없어서,
 *  위탁기관 담당자 줄에만 밑줄을 넣으면 그 줄만 튄다. 통일성을 위해 공백만 둔다.
 *  (이전에 `________` 를 썼던 것은 과잉 해석이었다 — 요구는 "적을 자리를 남겨라"였다.)
 *
 * ★ASCII 공백만 쓴다 — 전각 공백은 HCR 폰트 글리프 누락 시 두부(tofu)로 렌더될 수 있다.
 * ★개수는 `scripts/verify-pilot-pdf.mts --scan` 으로 확정한다. 두 조건을 동시에 만족해야 한다.
 *   ① 확보 폭 ≥ 33pt (한글 3자 ≈ 12mm) — 손으로 이름을 적을 수 있어야 한다
 *   ② wrap 0 — 서명 줄이 폭을 넘으면 pdfkit 이 줄바꿈하는데, `pdfkitRenderer:112` 의
 *      페이지 분할 가드가 높이를 `rows.length * 24` 로 계산하므로 한 행이 2줄이 되면
 *      높이를 과소평가해 서명 블록이 페이지를 넘는다
 *      (`3792360`·2026-07-20 서명부 분할 사고와 같은 클래스).
 *  ★가장 좁은 곳은 훈련일지다 — 오른쪽 경계가 `x + W - mm(10)` 로 10mm 좁다(`pdfkitRenderer:499`).
 */
// ASCII 공백 15개 = 49.5pt ≈ 17.5mm (사용자 확정 2026-08-13).
//  참고: 공백 1개 = 3.3pt, 활자 한글 3자 ≈ 32pt ≈ 11mm — 손글씨는 그보다 커서 여유를 둔다.
export const PILOT_HANDWRITE_BLANK = "               ";
