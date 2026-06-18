# 본인 확인 · 계좌 인증 설계 (민감정보 비보관 원칙)

작성: 2026-06-18 · 상태: **설계(미구현)** · 관련: 통장사본·근로계약 본인확인·급여 이체·구독(PRO "신분·통장 확인(향후 예정)")

> 핵심 원칙: **"검증은 하되 원본(신분증·통장 이미지)은 보관하지 않는다."**
> 인증 결과값(성명·생년월일·CI/DI·예금주명·인증여부/일시)만 저장하고, 신분증/통장 **사본 이미지는 저장하지 않는다.**
> 사용자(직무지도원)는 고령·디지털 취약 가능성이 높으므로 **매니저(위탁기관) 대행 + 비상호작용 방식**을 1순위로 한다.

---

## 🎯 목표

1. **급여 오이체 방지**: 이체 계좌가 "예금주 = 본인"인지 확인.
2. **계약 당사자 본인 확인**: 근로계약서 작성·서명 당사자가 실제 본인인지.
3. **계약 당사자 = 계좌주 동일성** 확인.
4. 위 1~3을 **민감정보(주민번호·신분증/통장 이미지) 보관 없이** 달성.
5. **고령·은행앱 없는 사용자도** 가능(매니저 대행·비상호작용 우선).

---

## 0. 현재 상태 (as-is)

- 결제 연동: **토스페이먼츠 전용 SDK** (`window.TossPayments`, `api.tosspayments.com`, `NEXT_PUBLIC_TOSS_CLIENT_KEY`). **포트원/아임포트 미사용.**
- 카카오: 알림톡 사용 중([[alimtalk_template_status_2026_06_12]]).
- 보유 중인 민감 데이터(`prisma/schema.prisma`)
  - `Worker.accountNumber` / `bankName` / `accountHolder` — 급여 이체용(셀프 입력 + 매니저 보완)
  - `Worker.passbookImageUrl` — **통장사본 이미지(비공개 Supabase 버킷)** ← 가장 무거운 민감 보유 항목
  - `Worker.birthDate`, `Worker.signatureUrl`
  - **주민등록번호 필드 없음 · 신분증 사본 필드 없음** (현재는 깨끗)
- 통장사본 업로드: 워커 본인(`/api/worker/passbook`) + 매니저 대행(`/api/admin/worker-accounts/[id]/passbook`) — 둘 다 비공개 버킷, 육안 검증.

문제: 통장사본 **이미지 보관 = 민감정보 유출 리스크**. 신분증까지 받으면 리스크 급증(주민번호 처리 금지 §24-2).

---

## 1. 검증 방식 매핑

| 요구 | 안티패턴(금지) | 권장 방식 | 사용자 행동 | 비고 |
|---|---|---|---|---|
| 계좌 정확성 | 통장사본 이미지 보관 | **예금주 실명조회** (은행+계좌번호 → 예금주명 반환) | **없음**(매니저가 계좌번호만 입력) | 고령·앱없음에 최적 |
| 계좌 본인성 보강 | — | 1원 송금 인증(코드 확인) | 입금자명 확인·입력 | **보조 수단**(앱/SMS 가능자만) |
| 신원(계약 본인확인) | 신분증 이미지·주민번호 저장 | 휴대폰/카카오 **본인인증** → CI/DI | 폰 인증(은행앱 불필요) | 디지털 가능자 |
| 신원(디지털 불가) | 신분증 이미지 보관 | **매니저 대면 확인** + (선택)신분증 **진위확인 API**(유효/무효만) | 실물 신분증 제시만 | 고령자 1순위 |
| 동일성(계약=계좌) | — | 본인인증 CI ↔ 예금주명 ↔ 계약 당사자 매칭 | 없음 | 동명이인은 CI로 분별 |

핵심: **예금주 실명조회는 비상호작용**(사용자가 아무것도 안 함) → 통장사본 이미지를 대체하고 고령자 문제를 동시에 해결.

---

## 2. 보관 정책 (데이터 최소화)

**보관 OK (저위험)**
- 성명, 생년월일
- **CI/DI**(가명 식별자 — 주민번호 아님)
- 계좌: `bankCode`, `accountNumber`(이체 필수 · **암호화/접근통제**), `accountHolder`(조회로 검증된 명의)
- 인증 메타: `verifiedAt`, `method`, `result(boolean)`, `provider`

**보관 금지 (고위험)**
- 주민등록번호(전체)
- 신분증 사본 이미지
- 통장 사본 이미지 ← 예금주 조회 도입 후 **폐기**

---

## 3. 데이터 모델 (제안 — 미적용)

이미지 컬럼을 새로 만들지 않는다. 결과값 전용.

```prisma
model Worker {
  // ... 기존 ...
  // 본인 확인(신원) — 이미지 비보관, 결과값만
  identityVerifiedAt   DateTime? @map("identity_verified_at")
  identityMethod       String?   @map("identity_method")   // MOBILE | KAKAO | INPERSON | ID_AUTHENTICITY
  ci                   String?   @map("ci")                // 연계정보(가명식별자, 88byte) — 동일성 매칭용
  // di 는 사이트별 식별자(중복가입 방지). 필요 시 추가.

  // 계좌 인증 — 결과값만
  bankCode             String?   @map("bank_code")
  accountVerifiedAt    DateTime? @map("account_verified_at")
  accountHolderVerified Boolean? @map("account_holder_verified") // 예금주명 = 본인 일치 여부
  accountVerifyMethod  String?   @map("account_verify_method")   // NAME_INQUIRY | ONE_WON
  // accountNumber 는 암호화 컬럼화 검토(또는 벤더 토큰)
}

model EmploymentContract {
  // ... 기존 ...
  signerCi             String?   @map("signer_ci")            // 서명 당사자 CI(계약=본인 증빙)
  signerVerifiedAt     DateTime? @map("signer_verified_at")
  signerVerifyMethod   String?   @map("signer_verify_method") // MOBILE | INPERSON ...
}
```

> 동일성 확인 = `Worker.ci == EmploymentContract.signerCi` && `accountHolderVerified == true`.
> 대면 확인(INPERSON)은 CI가 없을 수 있으므로 `identityMethod=INPERSON` + 매니저ID·일시로 감사 추적.

---

## 4. 벤더 선택지

| | 토스페이먼츠(현행 유지) | 포트원(PortOne) 신규 |
|---|---|---|
| 본인인증 | 토스 본인확인 API 직접 호출 | SDK로 인증창 → imp_uid 검증 |
| 계좌 인증 | 예금주조회/1원인증 API | 동일 통합 제공 |
| 추가 인프라 | **없음**(billing 코드 패턴 재사용) | 신규 SDK·계정 연동 |
| 관리 | 결제와 별개 호출 | 결제+인증 단일 콘솔(단, 현재 결제는 토스라 결제 이관 필요) |
| 과금 | 종량제(본인확인 ~40원/건, 1원/예금주 ~50원/건) | 종량제 유사 |

> 정정: 붙여받은 외부 조언은 "포트원 계정에서 활성화만"을 전제했으나, **본 시스템은 토스 전용**이라 포트원은 **신규 연동**이다.
> 권장: **토스 유지로 예금주조회·본인확인 API 직접 연동**(인프라 추가 0). 포트원은 향후 결제까지 통합할 의향이 있을 때.

---

## 5. 적용 단계 (Phased)

**P0 — 통장사본 기능 제거 + 처리방침 (✅ 완료, 2026-06-18)**
- 통장사본을 **수집한 적 없으므로 기능 자체를 제거**(워커/매니저 업로드 UI·API·스토리지 헬퍼 삭제, `Worker.passbook_image_url` 컬럼 드롭).
  → 민감 이미지 저장소 자체를 없앤 것이 가장 강한 리스크 축소.
- `app/privacy/page.tsx`에 **"원본 이미지 비보관 원칙"** 명문화 + 급여 계좌 수집 항목 명시.

**P1 — 계좌 예금주 조회 (최우선·고령자 해결)** ← P0 확인 후 진행
- `lib/verify/account.ts`(벤더 API 래퍼·provider 추상화) + `POST /api/admin/worker-accounts/[id]/verify-account`(매니저가 은행/계좌번호 입력 → 예금주명 반환·일치 판정).
- 결과만 저장(`accountVerifiedAt`, `accountHolderVerified`, `accountVerifyMethod=NAME_INQUIRY`).
- 인적관리 상세 모달 급여계좌 섹션에 **"계좌 인증"** 버튼 + 일치 뱃지.
- **통장사본 이미지는 부활시키지 않음**(예금주 조회로 일원화). 키 미설정 시 "미설정" 안내(passbookStorage 패턴).

**P2 — (불필요)** 통장 이미지가 없으므로 폐기 마이그레이션 불필요. P0에서 컬럼 드롭 완료.

**P3 — 본인 확인(신원)** — 골격 완료(2026-06-18)
- 스키마: `identityVerifiedAt`/`identityMethod`/`identityVerifiedBy` + CI는 `Worker.ciKey` 재활용.
- `lib/verify/identity.ts`(provider 추상화, 키 미설정 시 configured=false).
- `POST /api/admin/worker-accounts/[id]/verify-identity`:
  - `mode=inperson`: **매니저 대면 확인 즉시 가능**(무비용·수동·플랜 게이트 없음).
  - `mode=digital`: 휴대폰/카카오 본인인증 토큰 검증(**PRO 게이트 + 벤더 키** 필요, 키 미설정 시 503).
- 인적관리 상세 모달: "대면 본인 확인" 버튼 + 인증 뱃지.
- 디지털 활성화: `lib/verify/identity.ts callProvider()` 구현 + 프론트 본인인증 SDK 연결.

**구독 연계(2026-06-18)**: `planGuard`에 `VERIFICATION`(PRO) 추가. 계좌 인증·디지털 본인인증은 PRO 게이트. **대면 확인은 무비용이라 게이트 제외.**

**P4 — 동일성·자동화** — 골격 완료(2026-06-18)
- `lib/verify/payoutEligibility.ts`: `payoutGate(worker)`(계좌 검증 + 본인 확인 충족 시 이체 가능) + `verificationSummary()`.
- 키 없이도 현재 필드로 판정 동작. 급여 자동이체 기능이 생기면 실행 직전 `payoutGate()` 호출만 연결.
- **남은 강화(키 후)**: CI ↔ 예금주명 정밀 동일성(동명이인 분별) — `payoutGate()` 내 TODO.

---

## 6. 기존 구조 반영 포인트 (integration map)

| 영역 | 현재 | 반영 |
|---|---|---|
| 인적관리 상세 모달 `WorkerAccountDetailModal` | 통장사본 보기/업로드(매니저 대행) | **"계좌 인증" 버튼** 추가, 인증 뱃지(예금주 일치) 표시 |
| `/api/admin/worker-accounts/[id]/passbook` | 통장 이미지 업로드 | 폴백 유지. 신규 `verify-account` 라우트 추가 |
| `lib/passbookStorage.ts` | 통장 비공개 버킷 | P2에서 폐기 대상. 신규 `lib/verify/*` 추가 |
| 계약 `EmploymentContract`/서명 플로우 | 전자서명 | 서명 단계 본인인증(CI) 삽입, `signerCi` 저장 |
| 결제 `lib/...`/`/api/payments/*` | 토스 billing | 토스 본인확인·계좌조회 API 동일 패턴 재사용 |
| `app/privacy/page.tsx` | 처리방침 | 본인인증·계좌인증 수집항목·보유기간 갱신 |
| 구독 PRO | "신분·통장 확인(향후 예정)" | 출시 시 라벨에서 (향후 예정) 제거 |

---

## 7. 보안 · 법적 체크리스트

- [ ] 주민등록번호 **수집·저장 금지**(§24-2). 진위확인도 결과(유효/무효)만.
- [ ] 신분증·통장 **사본 이미지 비보관**(검증 수단으로만 사용 후 폐기).
- [ ] 계좌번호 암호화(at-rest) 또는 벤더 토큰화 검토. 접근 최소화(서버 스코프/RLS).
- [ ] CI/DI는 가명식별자 — 동일성·중복방지 목적에 한해 보관.
- [ ] 수집·이용 **동의** 항목화 + 처리방침 고지. 제3자(인증기관) 제공 고지.
- [ ] 보유기간·파기 정책(계약종료 후 N년, 임금대장 등 법정 보존과 균형).
- [ ] 인증 결과 접근 **감사 로깅**.

---

## 참고

- 결제 연동: `app/manager/subscription/page.tsx`, `app/api/payments/{charge,billing}/route.ts` (토스)
- 통장: `lib/passbookStorage.ts`, `app/api/worker/passbook/route.ts`, `app/api/admin/worker-accounts/[id]/passbook/route.ts`
- 관련 설계: [[payroll_automation_design_2026_06_16]] (급여 자동화·이체)
