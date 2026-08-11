# 배포 및 운영 매뉴얼

---

## 배포 환경

| 항목 | 값 |
|------|---|
| 플랫폼 | Vercel (Hobby) |
| 도메인 | https://able-link.co.kr |
| 배포 방식 | **CLI 수동 배포** — git push는 배포를 유발하지 않음 |
| 빌드 명령 | `prisma generate && next build` |
| DB | Supabase PostgreSQL (ap-northeast-2) |
| Vercel CLI | **56.4.1 고정** (아래 §CLI 버전 핀) |

> **★ 자동 배포는 없습니다** (2026-08-11 실측 정정).
> 이 문서는 오래도록 "`master` → 자동 배포"로 적혀 있었으나 사실이 아닙니다. 확인 근거:
> `vercel project inspect`에 Git 연결 섹션 없음 · GitHub 웹훅 0건 · 모든 배포가 git 브랜치가 아니라
> **사용자명(CLI)에 귀속** · push 이후에도 새 배포가 생기지 않음.
> 따라서 `git push`는 안전하며, **운영 반영은 항상 아래 절차를 명시적으로 실행해야** 합니다.

---

## 배포 절차

### 일반 코드 변경

```bash
git add .
git commit -m "feat: 기능 설명"
git push origin master        # ← 배포되지 않음. 원격 저장소 반영만.

npm run deploy:preview        # 1) Preview로 먼저 검증
npm exec -- vercel --prod     # 2) 승인 후 운영 반영 (로컬 핀 CLI 사용)
```

> Production 단축 스크립트는 **의도적으로 만들지 않았습니다.** 운영 배포는 오타나 습관으로
> 실행되면 안 되는 명령이라, 매번 전체 명령을 치도록 두는 편이 안전합니다.

### DB 스키마 변경 포함 시

```bash
# 1. 마이그레이션 파일 생성 (로컬)
npx prisma migrate dev --name 변경_설명

# 2. 커밋 + 푸시
git add prisma/
git commit -m "feat: DB 스키마 변경"
git push origin master

# 3. Vercel 배포 완료 후 마이그레이션 적용
npx prisma migrate deploy
```

> **주의**: `prisma migrate dev`는 인터랙티브 모드로 CI 환경에서 실행 불가.
> 로컬에서 생성 후 `migrate deploy`로 적용.

### 환경변수 변경 시

```bash
# Vercel CLI로 추가/수정
echo "값" | npx vercel env add 변수명 production --force

# 적용을 위해 Redeploy 필요 (로컬 핀 CLI 사용 — §CLI 버전 핀 참고)
npm exec -- vercel --prod
```

---

## CLI 버전 핀 (Vercel 56.4.1)

`package.json`의 `devDependencies.vercel`을 **정확히 `56.4.1`로 고정**하고 lockfile에 반영했습니다.

### 사유 (2026-08-11)

- **CLI 58.9.1에서 배포가 실패합니다.** 서버가 400 `invalid_root_directory`를 반환:
  ``If defined, the Root Directory must be a relative path not starting with `./` ...``
- **동일 환경·동일 프로젝트 설정에서 56.4.1은 성공합니다.** 두 시도는 수 분 간격이었고 그 사이
  프로젝트 설정을 바꾸지 않았습니다. 서버 저장값이 원인이라면 56.4.1도 실패했어야 합니다.
- 대시보드의 Root Directory 필드는 **비어 있습니다**(`./`는 placeholder, Save 버튼 비활성).
  `vercel project update --auto-detect root-directory`도 "Unchanged"로 no-op입니다.
  → 프로젝트 설정에 잘못된 값이 남아 있어 생긴 문제로 보기는 어렵습니다.
- **결론: 58.9.1에 종속된 회귀.** 정확한 원인은 **미확정**입니다. CLI 디버그가 배포 요청 본문을
  덤프하지 않아 무엇이 거부됐는지 직접 확인하지 못했습니다. 근거로 삼을 수 있는 것은
  "동일 환경에서 56.4.1 성공 / 58.9.1 실패"라는 대조 실험까지입니다.

### 핀의 한계 — 완전한 강제가 아님

| 실행 방식 | 사용되는 버전 |
|---|---|
| `npm exec -- vercel`, npm script 안의 `vercel` | ✅ 로컬 핀 56.4.1 |
| `npx vercel` (로컬 설치가 있을 때) | ✅ 로컬 핀 56.4.1 |
| **전역 설치된 `vercel`** | ❌ 전역 버전 |
| **`npx vercel@latest`** | ❌ 명시한 최신 버전 |

전역 CLI나 버전을 명시한 실행은 핀을 우회합니다. 배포가 `invalid_root_directory`로 실패하면
**가장 먼저 `vercel --version`을 확인**하십시오.

### 핀 해제 조건

후속 CLI 버전으로 `npm run deploy:preview`가 **성공하면** 핀을 갱신하거나 해제합니다.
확인 방법:

```bash
npx vercel@<후보버전> deploy --yes     # 성공하면 그 버전으로 핀 갱신 가능
```

성공을 확인하기 전에는 핀을 올리지 마십시오. 원인이 미확정이라 회귀가 조용히 돌아올 수 있습니다.

---

## Vercel 환경변수 관리

```bash
# 현재 등록된 변수 목록 확인
npx vercel env ls

# 변수 추가
echo "값" | npx vercel env add 변수명 production

# 변수 삭제
npx vercel env rm 변수명 production

# 로컬 .env와 Vercel production 동기화 확인
npx vercel env pull .env.vercel.production --environment production --yes
```

---

## DB 마이그레이션 운영

### 마이그레이션 상태 확인
```bash
npx prisma migrate status
```

### 긴급 스키마 수정 (마이그레이션 파일 없이)
```bash
# 개발/스테이징 전용 — 운영 사용 주의
npx prisma db push
```

### 마이그레이션 파일 수동 적용 처리
```bash
# 이미 DB에 적용된 마이그레이션을 이력에만 등록
npx prisma migrate resolve --applied 마이그레이션_이름
```

### Prisma Studio (DB GUI)
```bash
npx prisma studio
# http://localhost:5555
```

---

## Cron 작업 설정

`vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/daily",      "schedule": "0 15 * * *" },
    { "path": "/api/payments/charge", "schedule": "0 1 * * *"  }
  ]
}
```

- `0 15 * * *` = UTC 15:00 = KST 00:00 (일일 배치)
- `0 1 * * *` = UTC 01:00 = KST 10:00 (자동 결제)
- 인증: **헤더 전용** — `x-cron-secret` 헤더 또는 `Authorization: Bearer <CRON_SECRET>`(Vercel Cron 기본). `?secret=` 쿼리는 로그 유출 위험으로 제거됨

**수동 실행:**
```bash
curl -H "x-cron-secret: $CRON_SECRET" https://able-link.co.kr/api/cron/daily
```

---

## 로그 모니터링

- Vercel Dashboard → Functions → 실시간 로그 확인
- 주요 로그 키워드:
  - `[SMS stub]` — SMS 환경변수 미설정 시 발신 대체 로그
  - `[invite] SMS 발송 실패` — SMS 발송 오류
  - `[admin/dashboard]`, `[worker/invite/[id]]` — API 오류

---

## 롤백

```bash
# Vercel 대시보드에서 이전 배포로 즉시 롤백 가능
# Vercel → Deployments → 이전 배포 선택 → Promote to Production
```

DB 롤백이 필요한 경우:
```bash
# 마이그레이션 되돌리기는 수동 SQL 작업 필요
# Supabase Dashboard → SQL Editor에서 역방향 DDL 실행
```

---

## 결제 운영

### 테스트 → 운영 전환
1. 토스페이먼츠 대시보드에서 운영 키 발급
2. Vercel 환경변수 교체:
   - `NEXT_PUBLIC_TOSS_CLIENT_KEY`: `test_ck_` → `live_ck_`
   - `TOSS_PAYMENTS_SECRET_KEY`: `test_sk_` → `live_sk_`
3. Redeploy

### 결제 실패 처리
- `api/payments/charge` Cron이 실패하면 에이전시 플랜은 유지됨
- Vercel 함수 로그에서 실패 사유 확인 후 수동 처리

---

## 체크리스트

### 출시 직전
- [ ] Toss 결제 키 운영 키로 교체
- [ ] AWS SES 샌드박스 해제 확인
- [ ] 카카오 알림톡 환경변수 입력
- [ ] DB 마이그레이션 최신 상태 확인 (`prisma migrate status`)
- [ ] Cron Secret 설정 확인

### 정기 점검 (월 1회)
- [ ] Vercel 함수 오류 로그 확인
- [ ] DB 연결 풀 상태 확인 (Supabase Dashboard)
- [ ] 4대보험 요율 업데이트 (InsuranceRates 테이블)
- [ ] 만료된 초대 링크/서명 토큰 정리 (cron/daily에서 자동 처리)
