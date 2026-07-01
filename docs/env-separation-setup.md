# 환경 분리 — 개발 DB(dev) 셋업 체크리스트

목표: **로컬 개발은 dev DB**(별도 Supabase 프로젝트), **운영(Vercel)은 prod DB** 그대로. reset/seed/migrate가 운영을 타격하지 않게 한다.

> 운영 보호 가드: `scripts/_dbGuard.mts`. 파괴적 스크립트는 `.env`의 `DB_ENV=development`일 때만 자유 실행되고,
> 그 외(운영/미설정)면 차단된다. 강제 실행은 `CONFIRM_DESTRUCTIVE=1`.

## 0) 사전
- dev Supabase 프로젝트 생성됨 (예: bluederrick 계정의 `AbleLink-Dev`).
- **현재 `.env`(운영값)부터 백업**: `cp .env .env.prod.bak` (또는 안전한 곳에 복사). 운영 복구용.

## 1) dev 연결 문자열 확보 (Supabase 대시보드)
dev 프로젝트 → **Settings → Database → Connection string**
- **DATABASE_URL** = Transaction pooler (포트 **6543**) — 끝에 `?pgbouncer=true&connection_limit=1` 권장
- **DIRECT_URL** = Direct connection (포트 **5432**) — 마이그레이션용
- 비밀번호는 프로젝트 생성 시 정한 DB 비밀번호.

(선택, 스토리지까지 격리하려면) **Settings → API**
- **NEXT_PUBLIC_SUPABASE_URL** = dev 프로젝트 URL
- **SUPABASE_SERVICE_ROLE_KEY** = dev service_role 키

## 2) 로컬 `.env` 전환
```
DATABASE_URL="<dev pooled url>"
DIRECT_URL="<dev direct url>"
DB_ENV=development          # ★ 가드가 이 값으로 dev 판정
# (선택) 스토리지 격리 시
NEXT_PUBLIC_SUPABASE_URL="<dev>"
SUPABASE_SERVICE_ROLE_KEY="<dev>"
```
나머지 키(토스/Resend/Kakao/GROQ/GEMINI/Upstash/SES/NTS)는 당분간 그대로 둬도 되지만,
**로컬에서 실제 발송/결제/AI 호출이 운영 키로 나갈 수 있음** → 추후 테스트 키로 분리 권장.

## 3) 스키마 적용 + 데이터 시드 (dev DB가 빈 상태이므로)
```
npx prisma migrate deploy      # 90개 마이그레이션을 dev DB에 적용
npx tsx scripts/seed-all.mts   # DB_ENV=development 이므로 가드 통과, dev 데이터 생성
```
> ⚠️ 실행 전 가드 출력의 `host`가 **dev 프로젝트**인지 꼭 확인. prod host면 즉시 중단.

## 4) 검증
- `npm run dev` → 시드 계정으로 로그인 (manager01~03 / Manager1234!, worker 010-7000-xxxx / worker1234!, admin/admin1234!)
- 데이터가 dev에서 보이고, 운영 DB는 손대지 않았는지 확인.

## 운영(Vercel) 측
- Vercel은 **자체 환경변수**(Production scope)에 운영 `DATABASE_URL`/`DIRECT_URL`을 그대로 둠 → 로컬 `.env` 변경과 무관.
- 운영 마이그레이션은 종전처럼 **수동** `prisma migrate deploy`(운영 DIRECT_URL로) — dev에서 검증 후 적용.
- (후속) staging 추가 시 Vercel Preview scope + staging 브랜치 + staging DB로 확장.

## 롤백
- 운영값으로 되돌리려면 `.env.prod.bak`을 `.env`로 복사.

## ✅ 마이그레이션 드리프트 — 해결됨 (베이스라인 스쿼시, 2026-07-01, 커밋 6f08cf1)
**조치**: 90개를 단일 베이스라인 `00000000000000_init`(schema.prisma 기반, `admins` 직접 생성)으로 스쿼시.
- dev(bluederrick): `migrate resolve --applied 00000000000000_init`.
- prod(whitederrick, neverwhere admin만 남은 near-empty): `db push`로 User→Worker 리네임 잔재(FK/인덱스/제약 이름·2컬럼타입) 정렬(데이터 무손실) → `_prisma_migrations` TRUNCATE → `migrate resolve --applied`.
- 결과: 양쪽 `migrate status` "up to date", fresh replay·`migrate dev`·증분 `migrate deploy` 정상화. 옛 90개는 git 히스토리 보존(로컬 `prisma/migrations_archive/`는 gitignore).

아래는 당시 드리프트 조사 기록(히스토리 참고용).

### (해결 전 기록) fresh `migrate deploy` 실패 — 조사 결과 2026-06-30
**증상**: 빈 DB에 `prisma migrate deploy`로 90개를 순차 적용하면 `20260528_worker_invite_phone_verify`에서
`relation "admin_users" does not exist` (42P01)로 실패.

**원인(정밀)**:
- admin 테이블은 `20260113121139_add_admin_user`가 **`AdminUser`**(PascalCase)로 생성하고, 이후 거의 모든 FK도 `"AdminUser"("id")`를 참조.
- 그런데 **`20260528_worker_invite_phone_verify`·`20260610130000_admin_profile_fields` 2개만 `admin_users`(snake_case)** 를 참조 → 그 시점 실제 테이블명은 `AdminUser`라 실패.
- 게다가 현재 `schema.prisma`는 `@@map("admins")`인데 **`AdminUser`→`admins` 리네임 마이그레이션이 존재하지 않음**(운영 테이블은 마이그레이션 밖에서 `admins`로 바뀐 상태). = 다지점 드리프트.

**그래서**: 마이그레이션 히스토리는 fresh провиж닝의 신뢰원천이 아님. **스키마(`schema.prisma`)가 진실원천** → 새 환경은 `prisma db push`로 구축(현재 dev가 그렇게 됨).

**고치지 말 것**: 이미 적용된 마이그레이션 SQL을 편집하면 운영 `_prisma_migrations` 체크섬이 깨져 **향후 운영 `migrate deploy`가 차단**됨. 절대 retro-edit 금지.

**권장 워크플로(현재)**:
- dev/staging 새 DB → `prisma db push` (스키마 직접 동기화).
- 운영 → 신규 마이그레이션만 증분 `migrate deploy`(기존 히스토리 유지).

**근본 정리(추후 별도 세션, 신중히)**: 베이스라인 스쿼시 — 현재 스키마로 단일 기준 마이그레이션 1개 생성 → 기존 90개 아카이브 → 운영엔 `prisma migrate resolve --applied <baseline>`로 적용표시(데이터 변경 없음). 이후 fresh replay·`migrate dev` 정상화.
