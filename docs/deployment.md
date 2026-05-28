# 배포 및 운영 매뉴얼

---

## 배포 환경

| 항목 | 값 |
|------|---|
| 플랫폼 | Vercel (Hobby) |
| 도메인 | https://able-link.co.kr |
| 브랜치 | `master` → 자동 배포 |
| 빌드 명령 | `prisma generate && next build` |
| DB | Supabase PostgreSQL (ap-northeast-2) |

---

## 배포 절차

### 일반 코드 변경

```bash
git add .
git commit -m "feat: 기능 설명"
git push origin master
# → Vercel 자동 빌드·배포 시작 (약 2~3분)
```

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

# 적용을 위해 Redeploy 필요
npx vercel --prod --yes
```

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
- 인증: `x-cron-secret` 헤더 또는 `?secret=` 쿼리 파라미터

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
