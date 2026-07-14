# 작업 현황 — 2026-07-14 (19차: 구조적 근본종결 + 전수 감사)

## 요약

사용자 지적("매번 놓친다")에 따라, 20번째 감사를 도는 대신 **반복되던 두 클래스를 구조적으로 갭이 불가능하게** 만들고(사용자 선택), 그 뒤 전수 감사(11개 도메인)로 검증했다.

- **구조적 조치**: ①정원검사 → 단일 chokepoint `checkSiteCapacity` ②근태 소유권 → 단일 헬퍼 `ownedAttendanceWhere`
- **전수 감사 결과**: 결제·문서·근태KST/cron·인증·IDOR = clean(소진). 확정 P1×1·P2×1·P3(구조 완결)
- **검증**: tsc 0 · vitest 236 → **241** · 배정 ASSIGNED 생성 7경로 전수 + 근태 접근 라우트 전수

---

## 구조적 근본종결 (두 클래스)

### 정원검사 — 단일 chokepoint
`lib/assignmentCapacity.checkSiteCapacity(tx, siteId, selBySlot, opts?)` 신설(site 정원 조회 + filled groupBy + findCapacityOverflow). 흩어져 각자 재작성하던 5경로(직접배정·PATCH·respond·offers·recruit)를 이 하나로 교체. **모든 단일-슬롯 생성 경로 + finalize가 checkSiteCapacity를 거치고, 전부 현장 락 안에서 호출** → "새 경로가 검사를 빠뜨리는" 형제갭이 코드상 드러남.

### 근태 소유권 — 단일 헬퍼
`lib/attendance/ownership.ownedAttendanceWhere(agencyId) = { assignment: { agencyId } }` 신설. 근태 실귀속은 assignment.agencyId(non-null), Site.agencyId(참고용·nullable·공유현장)는 금지. 6개 inbox 액션 라우트가 공유. 읽기·목록·쓰기가 동일 기준.

---

## 전수 감사 확정·수정

- **[P1] `admin/workers/invite` siteId 소유검증 누락** (형제갭) — 타 기관 현장 id를 초대에 넣어 가입 시 배정 주입(정원 잠식·현장정보 접근). talent offer·직접배정엔 있는 `site.agencyId` 가드가 invite만 누락. → 소유 검증 추가(403). 소비측(worker/invite)도 checkSiteCapacity 이중방어.
- **[P2] 면제 1:多 연장수당 N배 과지급** — 그룹 연장(extTimeGroup)이 공유 세션인데 훈련생 N명 일지에 같은 값 → 합산 시 N배. `manualExtHoursFromLogs`(그룹=max, 개별=sum) 단일 헬퍼로 통일(computeRun ×2 + attendanceSheetPayload). 테스트 5.
- **[P3 구조 완결]** invite 소비를 정원 chokepoint+현장 락에 편입(마지막 미편입 생성경로) · offers·recruit를 현장 락으로 전환(chokepoint "항상 현장 락" 불변식을 참으로) · 워커 수정요청 알림을 assignment.agencyId 기준으로(공유현장 댕글링/누락 방지).

## clean 확인 (신규 없음·소진)

결제·구독(무결제/언더차지/멱등 닫힘) · 문서/공단/서명 · 근태/KST/cron(7섹션) · 인증/세션(3토큰 격리·sessionVersion 자매경로) · IDOR/기타리소스(스코핑 수렴).

## 유보 (사유 명시·정책/의도)

- audit-package placements writerId 무필터(현장 전체 커버리지 의도, 10차 주석) · invite GET workerName 노출(P3 저위험, rate-limit) · contracts 서명 write-back workType(E1-C 의도 트레이드오프) · bulk-generate 7일 초과 과거분 미자동확정(confirm-month 경로 존재) · 노무사 큐(209h·주휴 개근·같은날2배정·P1-13·프리랜서·휴일+연장).

## 다음 세션 시작점

배정 정원·근태 소유권 두 클래스가 단일 chokepoint로 수렴 — 이후엔 "새 생성/접근 경로가 그 함수를 호출하는지"만 보면 됨. 배포 스모크: 초대(타기관 현장 403)·정원 초과 배정 409·면제 1:多 연장 급여.
