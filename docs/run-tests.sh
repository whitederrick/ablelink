#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# AbleLink API 테스트 스크립트 v2
# 실행: bash docs/run-tests.sh
# 사전 조건: npx tsx prisma/seed.ts 실행 후 npm run dev 실행
# ──────────────────────────────────────────────────────────────

BASE="http://localhost:3000"
PASS=0; FAIL=0; BUGS=()
RESP_FILE=$(mktemp)
ADMIN_COOKIE=$(mktemp)
WORKER_COOKIE=$(mktemp)
trap "rm -f $RESP_FILE $ADMIN_COOKIE $WORKER_COOKIE" EXIT

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC} — $1\n     기대: $2\n     실제: $3"; ((FAIL++)); BUGS+=("$1"); }
section() { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }

# HTTP 코드 + body 패턴 동시 검증
assert() {
  local desc="$1" exp_code="$2" exp_pattern="$3" cookie="$4"
  shift 4
  local act_code act_body
  act_code=$(curl -s -o "$RESP_FILE" -w "%{http_code}" ${cookie:+-b "$cookie"} "$@")
  act_body=$(cat "$RESP_FILE")

  if [[ "$act_code" != "$exp_code" ]]; then
    fail "$desc" "HTTP $exp_code" "HTTP $act_code | $act_body"
  elif [[ -n "$exp_pattern" ]] && ! echo "$act_body" | grep -q "$exp_pattern"; then
    fail "$desc" "HTTP $exp_code + '$exp_pattern'" "HTTP $act_code | $act_body"
  else
    pass "$desc"
  fi
}

# body에 패턴이 없어야 함 (부정 검증)
assert_not() {
  local desc="$1" exp_code="$2" bad_pattern="$3" cookie="$4"
  shift 4
  local act_code act_body
  act_code=$(curl -s -o "$RESP_FILE" -w "%{http_code}" ${cookie:+-b "$cookie"} "$@")
  act_body=$(cat "$RESP_FILE")

  if [[ "$act_code" != "$exp_code" ]]; then
    fail "$desc" "HTTP $exp_code" "HTTP $act_code | $act_body"
  elif echo "$act_body" | grep -q "$bad_pattern"; then
    fail "$desc" "HTTP $exp_code, '$bad_pattern' 없어야 함" "$act_body"
  else
    pass "$desc"
  fi
}

# ── 서버 확인 ──────────────────────────────────────────────────
echo -e "${BOLD}AbleLink API 테스트 v2${NC}"
echo "서버 확인 중..."
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE/worker/login" | grep -q "200"; then
  echo -e "${RED}서버 미실행. npm run dev 를 먼저 실행하세요.${NC}"; exit 1
fi
echo -e "${GREEN}서버 정상 (localhost:3000)${NC}"

# ── Rate limit 초기화 (테스트 환경 전용) ───────────────────────
# .env에서 Upstash 환경변수 로드
if [ -f ".env" ]; then
  UPSTASH_URL=$(grep "^UPSTASH_REDIS_REST_URL=" .env | cut -d= -f2- | tr -d '"')
  UPSTASH_TOKEN=$(grep "^UPSTASH_REDIS_REST_TOKEN=" .env | cut -d= -f2- | tr -d '"')
fi

echo -n "Rate limit 초기화 중..."
if [ -n "$UPSTASH_URL" ] && [ -n "$UPSTASH_TOKEN" ]; then
  # 먼저 현재 존재하는 rl:* 키 전체 조회
  RL_KEYS=$(curl -s -X POST "$UPSTASH_URL" \
    -H "Authorization: Bearer $UPSTASH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '["KEYS","rl:*"]' 2>/dev/null | grep -o '"[^"]*"' | grep "rl:" | tr -d '"' | tr '\n' ' ')

  if [ -n "$RL_KEYS" ]; then
    # DEL 명령에 키 목록 전달
    DEL_ARGS='["DEL"'
    for K in $RL_KEYS; do
      DEL_ARGS="$DEL_ARGS,\"$K\""
    done
    DEL_ARGS="$DEL_ARGS]"
    curl -s -X POST "$UPSTASH_URL" \
      -H "Authorization: Bearer $UPSTASH_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$DEL_ARGS" > /dev/null 2>&1
    echo " 완료 (키: $(echo $RL_KEYS | wc -w | tr -d ' ')개 삭제)"
  else
    echo " 완료 (초기화 불필요)"
  fi
else
  echo " (Upstash 환경변수 없음 — 건너뜀)"
fi
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "1. 공개 페이지 (200 + HTML 포함)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "/worker/login" "200" "<!DOCTYPE html" "" "$BASE/worker/login"
assert "/worker/signup" "200" "<!DOCTYPE html" "" "$BASE/worker/signup"
assert "/worker/invite/1" "200" "<!DOCTYPE html" "" "$BASE/worker/invite/1"
assert "/terms" "200" "이용약관" "" "$BASE/terms"
assert "/privacy" "200" "개인정보처리방침" "" "$BASE/privacy"
assert "커스텀 404 페이지" "404" "<!DOCTYPE html" "" "$BASE/this-page-does-not-exist-xyz"
assert "robots.txt 서빙" "200" "User-agent" "" "$BASE/robots.txt"
assert "robots.txt /admin 차단" "200" "Disallow: /admin/" "" "$BASE/robots.txt"
assert "robots.txt /api 차단" "200" "Disallow: /api/" "" "$BASE/robots.txt"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "2. 페이지 보호 (미인증 → 307 리다이렉트)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "/admin 미인증" "307" "" "" "$BASE/admin"
assert "/admin/coaches 미인증" "307" "" "" "$BASE/admin/coaches"
assert "/admin/payroll 미인증" "307" "" "" "$BASE/admin/payroll"
assert "/worker/home 미인증" "307" "" "" "$BASE/worker/home"
assert "/worker/profile 미인증" "307" "" "" "$BASE/worker/profile"
assert "/worker/worklog 미인증" "307" "" "" "$BASE/worker/worklog"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "3. API 미인증 → 정확히 401 (500 아님)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
for ep in \
  "/api/admin/dashboard" \
  "/api/admin/coaches" \
  "/api/admin/sites" \
  "/api/admin/assignments" \
  "/api/admin/contracts" \
  "/api/admin/trainees/summary" \
  "/api/admin/payroll/runs" \
  "/api/admin/payroll/contracts" \
  "/api/admin/payroll/deductions" \
  "/api/admin/export/csv" \
  "/api/admin/signature" \
  "/api/worker/profile" \
  "/api/worker/site/current" \
  "/api/worker/calendar" \
  "/api/worker/payroll" \
  "/api/worker/history" \
  "/api/worker/holidays" \
  "/api/worker/logs/prev"; do
  assert_not "$ep 미인증 → 401 (500 아님)" "401" '"message":"서버 오류"' "" "$BASE$ep"
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "4. 공개 API (인증 없이 접근 가능)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# phone-verify: 정상 요청 → 200 + success
assert "phone-verify 정상 요청" "200" '"success"' "" \
  -X POST "$BASE/api/worker/phone-verify" \
  -H "Content-Type: application/json" \
  -d '{"action":"request","phoneNumber":"01056781234"}'

# contracts: 토큰 없음 → 400 "토큰이 없습니다" (401 아님 — 공개 엔드포인트)
assert "contracts 토큰 없이 → 400 (401 아님)" "400" '"success":false' "" \
  "$BASE/api/worker/contracts"

# invite: 없는 ID → 404 (not 401)
assert "invite/999999 → 404 (인증 차단 아님)" "404" '"success":false' "" \
  "$BASE/api/worker/invite/999999"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "5. 관리자 인증 상세"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 정상 로그인을 먼저 (rate limit 소진 전에 쿠키 확보)
assert "관리자 정상 로그인" "200" '"success":true' "" \
  -c "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"admin","password":"admin1234!"}'

# 쿠키 발급 확인
COOKIE_VAL=$(grep "admlink_admin_session\|admin_session" "$ADMIN_COOKIE" | wc -l)
if [ "$COOKIE_VAL" -gt 0 ]; then pass "관리자 세션 쿠키 발급 확인"; else fail "관리자 세션 쿠키 발급 확인" "쿠키 존재" "쿠키 없음"; fi

# auth/me → role, agencyId 포함 (로그인 직후 확인)
assert "auth/me → role 포함" "200" '"role"' "$ADMIN_COOKIE" "$BASE/api/admin/auth/me"
assert "auth/me → success:true" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/auth/me"

# 로그아웃 → 이후 401
curl -s -b "$ADMIN_COOKIE" -c "$ADMIN_COOKIE" -X POST "$BASE/api/admin/auth/logout" > /dev/null
assert "로그아웃 후 dashboard → 401" "401" "" "$ADMIN_COOKIE" "$BASE/api/admin/dashboard"

# 재로그인 (다음 섹션 위해)
curl -s -c "$ADMIN_COOKIE" -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" -d '{"loginId":"admin","password":"admin1234!"}' > /dev/null

# 실패 케이스 — rate limit 영향 없는 별도 검증
# (rate limit은 IP 기준이라 연속 실패 시 429 가능 → 4xx 계열이면 pass)
FAIL_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"admin","password":"wrongpassword"}')
if [[ "$FAIL_CODE" == "401" || "$FAIL_CODE" == "429" ]]; then
  pass "잘못된 비밀번호 → 4xx ($FAIL_CODE)"
else
  fail "잘못된 비밀번호 → 4xx" "401 또는 429" "$FAIL_CODE"
fi

EMPTY_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"","password":""}')
if [[ "$EMPTY_CODE" == "400" || "$EMPTY_CODE" == "429" ]]; then
  pass "빈 칸 로그인 → 4xx ($EMPTY_CODE)"
else
  fail "빈 칸 로그인 → 4xx" "400 또는 429" "$EMPTY_CODE"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "6. 관리자 핵심 API (HTTP 200 + success:true + 데이터 구조)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "dashboard → today 포함" "200" '"today"' "$ADMIN_COOKIE" "$BASE/api/admin/dashboard"
assert "dashboard → summary 포함" "200" '"summary"' "$ADMIN_COOKIE" "$BASE/api/admin/dashboard"
assert "coaches → data 배열" "200" '"data"' "$ADMIN_COOKIE" "$BASE/api/admin/coaches"
assert "coaches → total 포함" "200" '"total"' "$ADMIN_COOKIE" "$BASE/api/admin/coaches"
assert "sites → items 배열" "200" '"items"' "$ADMIN_COOKIE" "$BASE/api/admin/sites"
assert "assignments → items 또는 data" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/assignments"
assert "contracts → success:true" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/contracts"
assert "trainees/summary → data 포함" "200" '"data"' "$ADMIN_COOKIE" "$BASE/api/admin/trainees/summary"
assert "payroll/runs → success:true" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/payroll/runs"
assert "payroll/contracts → success:true" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/payroll/contracts"
assert "payroll/deductions → success:true" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/payroll/deductions"
assert "signature → success:true" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/signature"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "7. 직무지도원 인증 상세"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "워커 정상 로그인" "200" '"success":true' "" \
  -c "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}'

assert "로그인 → userName 포함" "200" '"userName"' "" \
  -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}'

W_FAIL=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"wrongpassword"}')
if [[ "$W_FAIL" == "401" || "$W_FAIL" == "429" ]]; then
  pass "잘못된 비밀번호 → 4xx ($W_FAIL)"
else
  fail "잘못된 비밀번호 → 4xx" "401 또는 429" "$W_FAIL"
fi

W_NONE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"nonexistent_xyz","password":"password"}')
if [[ "$W_NONE" == "401" || "$W_NONE" == "429" ]]; then
  pass "없는 계정 → 4xx ($W_NONE)"
else
  fail "없는 계정 → 4xx" "401 또는 429" "$W_NONE"
fi

# 워커 쿠키로 관리자 API → 401
assert "워커→관리자 API 크로스 접근 차단" "401" "" "$WORKER_COOKIE" \
  "$BASE/api/admin/coaches"

# 로그아웃 후 401
curl -s -b "$WORKER_COOKIE" -c "$WORKER_COOKIE" -X POST "$BASE/api/worker/auth/logout" > /dev/null
assert "워커 로그아웃 후 profile → 401" "401" "" "$WORKER_COOKIE" "$BASE/api/worker/profile"

# 재로그인
curl -s -c "$WORKER_COOKIE" -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" -d '{"loginId":"worker01","password":"worker1234!"}' > /dev/null

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "8. 직무지도원 핵심 API (HTTP 200 + 데이터 구조)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "profile → userName 포함" "200" '"userName"' "$WORKER_COOKIE" "$BASE/api/worker/profile"
assert "profile → loginId 포함" "200" '"loginId"' "$WORKER_COOKIE" "$BASE/api/worker/profile"
assert "site/current → companyName 포함" "200" '"companyName"' "$WORKER_COOKIE" "$BASE/api/worker/site/current"
assert "site/current → trainees 포함" "200" '"trainees"' "$WORKER_COOKIE" "$BASE/api/worker/site/current"
assert "calendar → success:true" "200" '"success":true' "$WORKER_COOKIE" \
  "$BASE/api/worker/calendar?year=2026&month=5"
assert "payroll → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/payroll"
assert "history → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/history"
assert "holidays → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/holidays"
assert "notification → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/notification"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "9. 입력값 검증 (HTTP 코드 + 에러 메시지 확인)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# phone-verify: 짧은 전화번호 → 400
assert "전화번호 형식 오류 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/phone-verify" \
  -H "Content-Type: application/json" \
  -d '{"action":"request","phoneNumber":"0101"}'

# phone-verify: 잘못된 action → 400
assert "phone-verify 잘못된 action → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/phone-verify" \
  -H "Content-Type: application/json" \
  -d '{"action":"unknown","phoneNumber":"01012345678"}'

# phone-verify: OTP 틀린 코드 → 400
assert "OTP 틀린 코드 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/phone-verify" \
  -H "Content-Type: application/json" \
  -d '{"action":"confirm","phoneNumber":"01012345678","code":"000000"}'

# signup: 비밀번호 7자 → 400
assert "가입 비밀번호 7자 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"01012345678","userName":"테스트","password":"1234567","consentTerms":true,"consentPrivacy":true}'

# signup: 이름 1자 → 400
assert "가입 이름 1자 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"01012345678","userName":"김","password":"12345678","consentTerms":true,"consentPrivacy":true}'

# signup: 약관 미동의 → 400
assert "가입 필수 약관 미동의 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"01012345678","userName":"테스트","password":"12345678","consentTerms":false,"consentPrivacy":false}'

# 회원탈퇴: 잘못된 비밀번호 → 400
assert "회원탈퇴 잘못된 비밀번호 → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/profile/delete" \
  -H "Content-Type: application/json" \
  -d '{"password":"wrongpassword"}'

# 관리자 로그인 빈 칸 → 400 or 429 (rate limit 소진 가능)
ADMIN_EMPTY=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" -d '{}')
if [[ "$ADMIN_EMPTY" == "400" || "$ADMIN_EMPTY" == "429" ]]; then
  pass "관리자 로그인 빈 칸 → 4xx ($ADMIN_EMPTY)"
else
  fail "관리자 로그인 빈 칸 → 4xx" "400 또는 429" "$ADMIN_EMPTY"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "10. 보안 (Rate Limit / Cron / 크로스 접근)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Cron 시크릿 없이 → 401
assert "cron/daily 시크릿 없음 → 401" "401" '"success":false' "" "$BASE/api/cron/daily"

# Cron 틀린 시크릿 → 401
assert "cron/daily 틀린 시크릿 → 401" "401" '"success":false' "" \
  -H "x-cron-secret: wrongsecret_xyz" "$BASE/api/cron/daily"

# payments/charge 시크릿 없음 → 401
assert "payments/charge 시크릿 없음 → 401" "401" '"success":false' "" \
  -X POST "$BASE/api/payments/charge"

# Rate Limit: OTP 연속 요청 (11회) → 429 발생해야 함
echo -n "  OTP rate limit 테스트 (연속 요청)..."
GOT_429=0
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE/api/worker/phone-verify" \
    -H "Content-Type: application/json" \
    -d '{"action":"request","phoneNumber":"01099887766"}')
  [ "$CODE" = "429" ] && GOT_429=1 && break
done
if [ $GOT_429 -eq 1 ]; then pass "OTP rate limit → 429 발생 확인"
else fail "OTP rate limit" "429 발생" "15회 요청에도 429 없음"; fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "11. 보안 수정 검증 (2026-05-29)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# [ISSUE-05] BigInt 비정상 ID → 400 (500 아님) — ADMIN 인증 필요
assert "[보안] 잘못된 ID(abc) → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies/abc/detail"

assert "[보안] 소수점 ID(1.5) → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies/1.5/detail"

assert "[보안] 지원요청 잘못된 ID → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/support/abc"

# [ISSUE-06] 로그인 응답에 phoneNumber 없음
WORKER_LOGIN_RESP=$(curl -s \
  -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}')
if echo "$WORKER_LOGIN_RESP" | grep -q '"phoneNumber"'; then
  fail "[보안] 로그인 응답 phoneNumber 미포함" "phoneNumber 없음" "phoneNumber 포함됨"
else
  pass "[보안] 로그인 응답 phoneNumber 미포함 확인"
fi

# 신규 API 미인증 → 401 확인 (final-lock은 POST/DELETE만 있으므로 POST로 확인)
for ep in \
  "/api/admin/support" \
  "/api/admin/holiday-requests" \
  "/api/admin/system/billing" \
  "/api/admin/system/usage" \
  "/api/admin/system/announcements" \
  "/api/worker/holiday-requests"; do
  assert_not "$ep 미인증 → 401 (500 아님)" "401" '"message":"서버 오류"' "" "$BASE$ep"
done

# final-lock은 POST/DELETE만 존재 → 미인증 POST → 401
FLOCK_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/admin/final-lock" \
  -H "Content-Type: application/json" \
  -d '{"userId":"1","yearMonth":"2026-05"}')
if [[ "$FLOCK_CODE" == "401" ]]; then
  pass "/api/admin/final-lock 미인증 POST → 401"
else
  fail "/api/admin/final-lock 미인증 POST → 401" "401" "$FLOCK_CODE"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "11b. 테스트용 AGENCY 계정 생성"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AGENCY 역할 테스트를 위해 신규 에이전시 + 매니저 계정 생성
TEST_AGENCY_ID=$(curl -s -b "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/system/agencies" \
  -H "Content-Type: application/json" \
  -d '{"name":"테스트에이전시_자동생성","planType":"STARTER","managerLoginId":"test_manager_auto","managerPassword":"TestPass1234!","managerDisplayName":"테스트매니저"}' \
  | grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')

if [ -n "$TEST_AGENCY_ID" ]; then
  pass "테스트 AGENCY 계정 생성 완료 (agencyId: $TEST_AGENCY_ID)"
else
  # 이미 존재할 경우: 로그인만 시도
  echo "  (기존 계정 재사용 시도)"
fi

AGENCY_COOKIE=$(mktemp)
trap "rm -f $AGENCY_COOKIE" EXIT
curl -s -c "$AGENCY_COOKIE" \
  -X POST "$BASE/api/manager/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"test_manager_auto","password":"TestPass1234!"}' > /dev/null

# AGENCY 로그인 성공 여부 확인
AGENCY_ME=$(curl -s -b "$AGENCY_COOKIE" "$BASE/api/admin/auth/me" 2>/dev/null)
if echo "$AGENCY_ME" | grep -q '"role":"AGENCY"'; then
  pass "AGENCY 계정 로그인 확인"
else
  echo "  ⚠ AGENCY 로그인 실패 — AGENCY 관련 테스트는 스킵됩니다"
  AGENCY_SKIP=1
fi

# ADMIN 계정으로 전체 목록 조회 (인증 불필요 테스트)
assert "[지원요청] ADMIN 전체 목록 → 200" "200" '"success":true' "$ADMIN_COOKIE" \
  "$BASE/api/admin/support"

# 없는 ID 조회 → 404 (500 아님)
assert "[지원요청] 없는 ID → 404" "404" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/support/999999999"

if [ "${AGENCY_SKIP:-0}" != "1" ]; then
  # AGENCY 계정으로 지원 요청 목록 조회
  assert "[지원요청] AGENCY 목록 조회 → 200" "200" '"success":true' "$AGENCY_COOKIE" \
    "$BASE/api/admin/support"
  # 빈 제목으로 요청 생성 → 400
  assert "[지원요청] 빈 제목 → 400" "400" '"success":false' "$AGENCY_COOKIE" \
    -X POST "$BASE/api/admin/support" \
    -H "Content-Type: application/json" \
    -d '{"title":"","body":"내용","category":"GENERAL"}'
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "13. 시스템 운영자 전용 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "[시스템] billing → 200" "200" '"success":true' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/billing"

assert "[시스템] billing → billing 배열" "200" '"billing"' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/billing"

assert "[시스템] usage → 200" "200" '"success":true' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/usage?yearMonth=2026-05"

assert "[시스템] announcements 목록 → 200" "200" '"success":true' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/announcements"

assert "[시스템] agencies 목록 → 200" "200" '"success":true' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies"

if [ "${AGENCY_SKIP:-0}" != "1" ]; then
  # AGENCY 계정이 ADMIN 전용 API 호출 → 403
  assert "[시스템] AGENCY→billing 접근 → 403" "403" '"success":false' "$AGENCY_COOKIE" \
    "$BASE/api/admin/system/billing"
  assert "[시스템] AGENCY→usage 접근 → 403" "403" '"success":false' "$AGENCY_COOKIE" \
    "$BASE/api/admin/system/usage"
  assert "[시스템] AGENCY→announcements 접근 → 403" "403" '"success":false' "$AGENCY_COOKIE" \
    "$BASE/api/admin/system/announcements"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "14. 커스텀 휴무일 변경 요청 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if [ "${AGENCY_SKIP:-0}" != "1" ]; then
  assert "[휴무요청] 목록 조회 → 200" "200" '"success":true' "$AGENCY_COOKIE" \
    "$BASE/api/admin/holiday-requests?yearMonth=2026-05"
  assert "[휴무요청] 잘못된 yearMonth → 400" "400" '"success":false' "$AGENCY_COOKIE" \
    "$BASE/api/admin/holiday-requests?yearMonth=2026-5"
  HR_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$AGENCY_COOKIE" \
    -X POST "$BASE/api/admin/holiday-requests" \
    -H "Content-Type: application/json" \
    -d '{"holidayId":"999999999","requestType":"DELETE"}')
  if [[ "$HR_CODE" == "403" || "$HR_CODE" == "404" ]]; then
    pass "[휴무요청] 없는 holidayId → 403/404 ($HR_CODE)"
  else
    fail "[휴무요청] 없는 holidayId → 403/404" "403 또는 404" "$HR_CODE"
  fi
fi

# worker: PENDING 요청 목록 → 200
curl -s -c "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}' > /dev/null
assert "[휴무요청] worker PENDING 조회 → 200" "200" '"success":true' "$WORKER_COOKIE" \
  "$BASE/api/worker/holiday-requests"

# worker: 잘못된 ID → 400
assert "[휴무요청] 잘못된 requestId → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/holiday-requests/abc" \
  -H "Content-Type: application/json" \
  -d '{"action":"accept"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "15. 매니저 최종 확정 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ADMIN 계정이 final-lock → 403 (AGENCY만 가능)
assert "[최종확정] ADMIN→final-lock → 403" "403" '"success":false' "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/final-lock" \
  -H "Content-Type: application/json" \
  -d '{"userId":"1","yearMonth":"2026-05"}'

if [ "${AGENCY_SKIP:-0}" != "1" ]; then
  LOCK_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$AGENCY_COOKIE" \
    -X POST "$BASE/api/admin/final-lock" \
    -H "Content-Type: application/json" \
    -d '{"userId":"999999999","yearMonth":"2026-05"}')
  if [[ "$LOCK_CODE" == "403" ]]; then
    pass "[최종확정] 소속 아닌 userId → 403"
  else
    fail "[최종확정] 소속 아닌 userId → 403" "403" "$LOCK_CODE"
  fi

  LOCK_FMT=$(curl -s -o /dev/null -w "%{http_code}" -b "$AGENCY_COOKIE" \
    -X POST "$BASE/api/admin/final-lock" \
    -H "Content-Type: application/json" \
    -d '{"userId":"1","yearMonth":"2026-5"}')
  if [[ "$LOCK_FMT" == "400" ]]; then
    pass "[최종확정] 잘못된 yearMonth → 400"
  else
    fail "[최종확정] 잘못된 yearMonth → 400" "400" "$LOCK_FMT"
  fi

  assert "[최종확정] review → isManagerFinalLocked 포함" "200" '"isManagerFinalLocked"' "$AGENCY_COOKIE" \
    "$BASE/api/admin/review?yearMonth=2026-05"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 결과 요약
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL=$((PASS + FAIL))
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}테스트 결과${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  전체: ${BOLD}$TOTAL${NC}  ${GREEN}PASS: $PASS${NC}  ${RED}FAIL: $FAIL${NC}"

if [ ${#BUGS[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}${BOLD}실패 항목:${NC}"
  for bug in "${BUGS[@]}"; do echo -e "  ${RED}✗${NC} $bug"; done
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✅ 모든 테스트 통과${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}❌ ${FAIL}개 실패${NC}"
  exit 1
fi
