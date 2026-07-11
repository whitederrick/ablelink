# 코드베이스 확인 감사 6·7·8차 종합 (2026-07-11)

5차(billingEpoch 무료사이클 근본차단) 이후 이어진 6·7·8차 확인 감사. 각 라운드 = 8개 버그
클래스 병렬 헌트 + 적대적 검증(다중 에이전트 워크플로우). **placeholder 출근행 클래스**가
반복 핫스팟으로 드러나 3라운드에 걸쳐 근본 종결됨.

## 수렴 추세 (확정 버그 수)
```
1차 18 → 2차 9 → 3차 2 → 4차 3 → 5차 3 → 6차 2 → 7차 3 → 8차 7
                                              └── placeholder 클래스 whack-a-mole ──┘
```
6차 이후 상승(2→3→7)은 새 버그 유입이 아니라 **한 클래스(placeholder)의 미발견 sibling들이
순차 노출**된 것. 8차서 근본 chokepoint 도입으로 클래스 종결.

## 배포 커밋
| 라운드 | 커밋 | 확정 | vitest |
|---|---|---|---|
| 6차 | `38e1afd` | 2 (P2×2) | 213 |
| 7차 | `330385e` | 3 (P1×2·P2) | 213 |
| 8차 | `db6f029` | 5 수정 (P2×2·P3×3) | 213 |

전부 tsc0·스키마 변경 없음(코드만). master 직접 push → Vercel 자동배포.

---

## 핵심 서사: placeholder 유령/누락 근무일 클래스

### 근본 원인
워커가 **출근(clock-in) 없이 일지만 저장**하면 `logs/save`의 `findOrCreateAttendance`가
`{workerId, siteId, assignmentId, workDate}`만으로 `DailyAttendance`를 생성한다. 스키마 기본값이
`status=WORKING`, `startTime/actualStartTime=null`, `isFinalClosed=false`인 **placeholder** 행이다.

팀의 설계 불변식(`computeRun.ts` 주석): **"시각 없는 행은 isFinalClosed=true 금지"** — 급여 쿼리는
`isFinalClosed:true`만 신뢰하므로, 이 불변식이 깨지면 유령 근무일이 급여에 잡힌다. 이 불변식을
**write측에서** 강제하기로 했고(2026-07-06 computeRun 자체 가드는 제거), 그래서 finalize 경로마다
가드가 필요했는데 — **경로가 많아 매 라운드 새는** 반쪽수정이 반복됐다.

### 라운드별 발견/수정
- **6차 #1 (P2):** worker `late-clockout`이 `actualStartTime` 미검사 → placeholder 확정 → 유령
  근무일(과지급). `!actualStartTime` 가드 추가.
- **7차 #A (P1):** 매니저 쌍둥이 `confirm-missed-clockout` 미수정. 게다가 매니저 UI는 확정 버튼을
  **능동 노출**(워커는 homeSummary 필터로 숨김)해 더 도달 쉬움. 가드 + `attendance-inbox`
  missedClockOut 플래그에 actualStartTime 추가(버튼 차단).
- **7차 #C (P1):** **정반대 방향 — 과소지급.** 면제 배정은 cron 섹션4가 급여 확정행 생성. 면제
  워커가 당일 일지 먼저 저장 → placeholder → 그날밤 cron이 existRows로 발견해 **확정행 생성 스킵**
  → 영구 미확정 → 급여 조용한 누락. cron이 스킵 대신 **bare placeholder를 시각 채워 확정으로 '채택'**
  (신규생성 등가·주말/공휴일/휴무 미채택·멱등).
- **8차 #1~3:** finalize 경로가 **3개 더** 발견 — `home/[workerId]` 자동마감(P2)·worker
  `[id]/confirm`(P3)·admin `attendances/[id]` PATCH(P3). 전부 startTime 가드 없이 확정 가능.

### 8차: 근본 chokepoint로 종결
3라운드 whack-a-mole이 증명하듯 write측 가드는 새 경로마다 샌다. → **`computeRun`의 급여 두 쿼리
(당월·lookback)에 `startTime: {not:null}` 단일 chokepoint** 추가. 어떤 finalize 경로로 확정되든
유령 근무일이 `workedDays`/급여/주휴 만근판정에 **절대 안 잡힘.**

- **`startTime` 기준**(actualStartTime 아님)이 핵심: 2026-07-06 제거된 가드는 actualStartTime 기준이라
  면제/일괄 정상행(actualStartTime=null·startTime有)까지 배제해 과소집계됐다. startTime 기준은 정상행을
  건드리지 않는다(정상 근무일은 clock-in·cron면제·bulk·confirm-month 전부 startTime 보유).
- **dev DB 실증:** 확정행(isFinalClosed=true) 44건 중 startTime=null **0건** → chokepoint가
  제외하는 정상행 0. startTime=null 확정행은 오직 placeholder 버그뿐임을 실데이터로 확인.
- **이중 방어:** chokepoint(급여 무해화) + write측 3경로 가드(나쁜 DB 상태 원천 차단).

---

## 그 외 확정 수정 (8차)
- **#5 (P2):** 워커 셀프 비번변경(`worker/profile` PATCH)이 `sessionVersion` 미증가 → 탈취 토큰
  미무효화. `sv+1` 추가(update 후 쿠키 재발급이 새 sv 담아 **현재 세션 유지·타 세션 무효**). 이로써
  5개 비번변경 경로(셀프재설정·onboarding·admin·운영자·셀프변경) 전부 sv 일관.
- **#7 (P3):** 자동 공단제출(SUBMITTED) 전이가 `AuditEvent` 미기록 → `audit()` 추가(수동
  gov-status 경로와 통일). AccessLog는 기존대로 기록됨(법정 PII 제공 기록은 이미 있었음).

## 6·7차 그 외 수정
- **6차 #3 (P2):** 문서생성 5경로(buildDocPayload·worker/admin docs generate·preview)의 traineeLog
  조회에 `siteId` 누락 → 멀티현장 훈련생 타현장 로그가 공단문서 혼입. 13쿼리 `siteId=site.id` 추가
  (`attendanceSheetPayload` 선례). 단일현장 결과 불변, 멀티현장 오염만 제거.
- **7차 #B (P2):** admin/운영자 비번초기화가 sv 미증가(#5의 콘솔 형제). 두 경로 sv+1.

---

## 미수정 (판단 대기)
| 항목 | 사유 |
|---|---|
| **#4** 프리랜서(3.3% BUSINESS)에 근로기준법 연장·야간·휴일 가산 자동적용 | 급여 **정책**(사업소득자 법정수당 지급 여부) — 노무사 확정 권장. 주휴 게이트는 이미 EMPLOYMENT만 허용(선례상 제외가 맞아 보임) |
| **#6** finalize 정원 가드가 워커락 밖 → 동시확정 시 현장정원 초과(TOCTOU) | P3 저빈도. site-level 락 필요 시 별도 수정 |
| #2·P1-13 | 일용소득세·MONTHLY 개근월 휴일가산 — 노무사 대기(기존) |
| #16·Z·rate2 read | 데이터/보류/선택(기존) |

## 검증 원칙 (이번 세션 강화)
사용자 요구로 **매 수정을 before/after 영향도 평가**와 함께 처리. 회귀 전수 점검 축:
비면제·주말·멱등·대칭(형제경로)·정상경로 무영향. 급여 핵심 변경(chokepoint)은 dev DB 실측으로 확증.

## 다음
9차 확인 감사로 chokepoint 도입 후 placeholder 클래스 근본 종결 여부 확증 권장. #4·#6 사용자/노무사 결정 반영.
