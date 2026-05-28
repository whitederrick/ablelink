#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# AbleLink API 테스트 스크립트
# 실행: bash docs/run-tests.sh
# 사전 조건: 서버가 localhost:3000에서 실행 중이어야 함
#            (npx tsx prisma/seed.ts 로 테스트 데이터 필요)
# ──────────────────────────────────────────────────────────────

BASE="http://localhost:3000"
PASS=0
FAIL=0
BUGS=()

# 임시 쿠키 파일
ADMIN_COOKIE=$(mktemp)
WORKER_COOKIE=$(mktemp)
OTHER_COOKIE=$(mktemp)
trap "rm -f $ADMIN_COOKIE $WORKER_COOKIE $OTHER_COOKIE" EXIT

# ── 색상 ──────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── 헬퍼 ──────────────────────────────────────────────────────
pass() { echo -e "  ${GREEN}✅ PASS${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC} $1 ${RED}[기대: $2 / 실제: $3]${NC}"; ((FAIL++)); BUGS+=("$1"); }
section() { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }

check_status() {
  local desc="$1" expected="$2" cookie="$3"
  shift 3
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" ${cookie:+-b "$cookie"} "$@")
  if [ "$actual" = "$expected" ]; then pass "$desc"; else fail "$desc" "$expected" "$actual"; fi
}

check_body() {
  local desc="$1" pattern="$2" cookie="$3"
  shift 3
  local body
  body=$(curl -s ${cookie:+-b "$cookie"} "$@")
  if echo "$body" | grep -q "$pattern"; then pass "$desc"; else fail "$desc" "*$pattern*" "$body"; fi
}

# ── 서버 확인 ──────────────────────────────────────────────────
echo -e "${BOLD}AbleLink API 테스트${NC}"
echo "서버 확인 중..."
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE/worker/login" | grep -q "200"; then
  echo -e "${RED}서버가 실행 중이지 않습니다. npm run dev 를 먼저 실행하세요.${NC}"
  exit 1
fi
echo -e "${GREEN}서버 정상 (localhost:3000)${NC}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "1. 공개 페이지 접근"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_status "/worker/login 접근" "200" "" "$BASE/worker/login"
check_status "/worker/signup 접근" "200" "" "$BASE/worker/signup"
check_status "/terms 접근" "200" "" "$BASE/terms"
check_status "/privacy 접근" "200" "" "$BASE/privacy"
check_status "존재하지 않는 URL → 404" "404" "" "$BASE/this-page-does-not-exist-xyz"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "2. 페이지 보호 (미인증 → 리다이렉트)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_status "/admin 미인증 → 307" "307" "" "$BASE/admin"
check_status "/admin/coaches 미인증 → 307" "307" "" "$BASE/admin/coaches"
check_status "/worker/home 미인증 → 307" "307" "" "$BASE/worker/home"
check_status "/worker/profile 미인증 → 307" "307" "" "$BASE/worker/profile"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "3. API 미인증 접근 → 401"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_status "/api/admin/dashboard 미인증" "401" "" "$BASE/api/admin/dashboard"
check_status "/api/admin/coaches 미인증" "401" "" "$BASE/api/admin/coaches"
check_status "/api/admin/sites 미인증" "401" "" "$BASE/api/admin/sites"
check_status "/api/admin/trainees/summary 미인증" "401" "" "$BASE/api/admin/trainees/summary"
check_status "/api/worker/profile 미인증" "401" "" "$BASE/api/worker/profile"
check_status "/api/worker/calendar 미인증" "401" "" "$BASE/api/worker/calendar"
check_status "/api/worker/payroll 미인증" "401" "" "$BASE/api/worker/payroll"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "4. 공개 API 접근 (인증 불필요)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_body "phone-verify (유효한 번호)" "success" "" \
  -X POST "$BASE/api/worker/phone-verify" \
  -H "Content-Type: application/json" \
  -d '{"action":"request","phoneNumber":"01087654321"}'

check_body "contracts (토큰 없음 → success:false, not 401)" "success" "" \
  "$BASE/api/worker/contracts"

check_body "invite/999999 (없는 ID → success:false, not 401)" "success" "" \
  "$BASE/api/worker/invite/999999"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "5. 관리자 인증"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_body "관리자 정상 로그인" '"success":true' "" \
  -c "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"admin","password":"admin1234!"}'

check_body "관리자 잘못된 비밀번호" '"success":false' "" \
  -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"admin","password":"wrongpassword"}'

check_body "관리자 빈 칸 로그인" '"success":false' "" \
  -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"","password":""}'

check_body "세션 확인 (auth/me)" '"success":true' "$ADMIN_COOKIE" \
  "$BASE/api/admin/auth/me"

# 로그아웃 → 세션 만료 확인
curl -s -b "$ADMIN_COOKIE" -c "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/auth/logout" > /dev/null

check_status "관리자 로그아웃 후 dashboard → 401" "401" "$ADMIN_COOKIE" \
  "$BASE/api/admin/dashboard"

# 재로그인
curl -s -c "$ADMIN_COOKIE" -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"admin","password":"admin1234!"}' > /dev/null

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "6. 관리자 핵심 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_body "dashboard" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/dashboard"
check_body "coaches 목록" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/coaches"
check_body "sites 목록" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/sites"
check_body "assignments 목록" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/assignments"
check_body "contracts 목록" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/contracts"
check_body "trainees/summary (인증)" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/trainees/summary"
check_body "payroll/runs 목록" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/payroll/runs"
check_body "payroll/contracts 목록" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/payroll/contracts"
check_body "payroll/deductions 목록" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/payroll/deductions"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "7. 직무지도원 인증"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_body "직무지도원 정상 로그인" '"success":true' "" \
  -c "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}'

check_body "직무지도원 잘못된 비밀번호" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"wrongpassword"}'

check_body "워커 쿠키로 관리자 API 접근 → 차단" '"success":false' "$WORKER_COOKIE" \
  "$BASE/api/admin/coaches"

# 로그아웃 → 재로그인
curl -s -b "$WORKER_COOKIE" -c "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/auth/logout" > /dev/null

check_status "직무지도원 로그아웃 후 profile → 401" "401" "$WORKER_COOKIE" \
  "$BASE/api/worker/profile"

curl -s -c "$WORKER_COOKIE" -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}' > /dev/null

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "8. 직무지도원 핵심 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_body "profile 조회" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/profile"
check_body "site/current 조회" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/site/current"
check_body "calendar 조회" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/calendar?year=2026&month=5"
check_body "payroll 조회" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/payroll"
check_body "history 조회" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/history"
check_body "holidays 조회" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/holidays"
check_body "notification 조회" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/notification"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "9. 입력값 검증"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_body "전화번호 형식 오류 (짧은 번호)" '"success":false' "" \
  -X POST "$BASE/api/worker/phone-verify" \
  -H "Content-Type: application/json" \
  -d '{"action":"request","phoneNumber":"0101"}'

check_body "OTP 틀린 코드 → 오류" '"success":false' "" \
  -X POST "$BASE/api/worker/phone-verify" \
  -H "Content-Type: application/json" \
  -d '{"action":"confirm","phoneNumber":"01011112222","code":"000000"}'

check_body "가입 - 비밀번호 7자 이하 → 오류" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"01011112222","userName":"테스트","password":"1234567","consentTerms":true,"consentPrivacy":true}'

check_body "회원탈퇴 - 잘못된 비밀번호" '"success":false' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/profile/delete" \
  -H "Content-Type: application/json" \
  -d '{"password":"wrongpassword"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "10. 보안"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
check_status "Cron 시크릿 없이 /api/cron/daily" "401" "" "$BASE/api/cron/daily"

check_status "Cron 틀린 시크릿" "401" "" \
  -H "x-cron-secret: wrongsecret" "$BASE/api/cron/daily"

check_status "payments/charge 시크릿 없음" "401" "" \
  -X POST "$BASE/api/payments/charge"

# robots.txt
check_body "robots.txt - /admin/ 차단 포함" 'Disallow: /admin/' "" \
  "$BASE/robots.txt"

check_body "robots.txt - /api/ 차단 포함" 'Disallow: /api/' "" \
  "$BASE/robots.txt"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 결과 요약
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL=$((PASS + FAIL))
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}테스트 결과${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  전체: $TOTAL  ${GREEN}PASS: $PASS${NC}  ${RED}FAIL: $FAIL${NC}"

if [ ${#BUGS[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}${BOLD}실패 항목:${NC}"
  for bug in "${BUGS[@]}"; do
    echo -e "  ${RED}✗ $bug${NC}"
  done
fi

if [ $FAIL -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}✅ 모든 테스트 통과${NC}"
  exit 0
else
  echo -e "\n${RED}${BOLD}❌ $FAIL개 실패${NC}"
  exit 1
fi
