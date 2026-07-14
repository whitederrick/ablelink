# 작업 현황 — 2026-07-14 (21차 원점 심층 전수 감사 2회차)

## 요약

20차에 이어 "상세 전수" 재요청. 8개 세분 에이전트(20차 수정 회귀검증 1 + 도메인 7)로 재감사. **20차 수정은 회귀 없음 확증**(fix 후 감사가 효과), 신규 P2×4 + P3 확인. P0/P1 없음(소진 상태). 사용자 승인 범위(P2×4 + 명확한 P3) 수정, tsc0·vitest241·스키마無.

## 수정 (P2×4 + 명확한 P3)

### P2
- **출근부 placeholder 누출**(`attendanceSheetPayload.ts:75`): 공단 출근부 쿼리에 `startTime:{not:null}` 추가 — computeRun:133 chokepoint의 형제갭(면제 유령 8h·문서↔급여 불일치 종결).
- **docs/submitted UTC 경계**(`admin/docs/submitted:23`): KST(+09:00)로 통일 — 다음 기간 run이 겹침에 걸려 미제출 출근부가 "제출됨"으로 가려지던 것(공단 제출 누락) 차단.
- **공고 동시수락 Site 중복**(`recruit-applications/[id]` + `assignmentLock.withPostAndWorkerLock`): 신규 현장 find-or-create를 postId advisory 락으로 직렬화 + 락 안 siteId 재조회 → 물리 Site 중복 생성·정원검사 무력화 방지.
- **sign-token SMS rate-limit**(`agency-profile/sign-token`): 매니저·전화 기준 rate-limit 추가 — 임의 번호 SMS 폭탄·비용 남용 차단(형제 phone-verify와 정합).

### 명확한 P3 (형제갭 정리)
- charge 크론 CRON_SECRET `timingSafeEqual`(20차 daily만 고친 형제갭)
- worker→manager 알림 라우팅을 `assignment.agencyId`로: respond·docs/submit(20차 edit-request만 고친 형제갭). docs/submit은 DocumentRun.agencyId도 실귀속으로 통일.
- `admin/assignments` GET 목록 스코프 `site.agencyId`→`assignment.agencyId` + hasContract 계약조회 agencyId 필터(근태 소유권 클래스 마지막 목록 형제갭)
- cron §4 면제 출근부 status에 `ENDED` 추가(종료 면제워커 마지막날 급여 자가치유)

## 미결 — 당신 결정 대기 (A)
1. **self-confirm 임의 startTime/endTime 수용**(P3): 보정 도구 의도 vs edit-request 승인 플로 강제 — 결정 필요
2. **/manager/docs 멀티현장 문서 주소지정**(P3, UI 현장선택기 = 중간 작업): 지금 vs 백로그
3. **cron §5 만족도조사 중복 알림톡**(P3, SURVEY_AUTO_SEND 기본 OFF): 방어적 지금 vs 기능 켤 때

## 노무사/스키마 큐 (외부 결정 대기)
비연속 근무요일(MWF/TTh)→주휴·MONTHLY 과소지급(EmploymentContract 근무요일 필드 = 스키마 설계) · 건강보험 8일 · tier 소정기준 · 사업소득세 2단계 절사 · contract-sign 슬롯정원(E1-C) · finalize 집계 통일 · §6 cron 말일 캐치업(교차월)

## 백로그 (표시 nit)
공지 멀티기관 워커 중복표시 · docs/preview docType 불일치 · survey/sign-self POST rate-limit · supportStorage 클라 path · candidates 타기관 현장명 · unguarded BigInt 잔여

## 결론
크로스테넌트/인증/급여코어/SSRF/injection/업로드 소진 재확인. 2회 연속 심층 재감사가 각각 실질 결함을 잡음(20차 P1, 21차 P2×4) → 정기 심층 재감사 가치 지속 확인. P0/P1은 소진.
