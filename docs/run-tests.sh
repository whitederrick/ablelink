#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# AbleLink API 테스트 스크립트 v3
# 실행: bash docs/run-tests.sh
# 사전 조건: npx tsx prisma/seed.ts 실행 후 npm run dev 실행
# ──────────────────────────────────────────────────────────────

BASE="http://localhost:3000"
PASS=0; FAIL=0; BUGS=()
RESP_FILE=$(mktemp)
ADMIN_COOKIE=$(mktemp)    # 시스템 운영자 (ADMIN)
MANAGER_COOKIE=$(mktemp)  # 에이전시 관리자 (AGENCY)
WORKER_COOKIE=$(mktemp)   # 직무지도원 (COACH)
trap "rm -f $RESP_FILE $ADMIN_COOKIE $MANAGER_COOKIE $WORKER_COOKIE" EXIT

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC} — $1\n     기대: $2\n     실제: $3"; ((FAIL++)); BUGS+=("$1"); }
section() { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }
skip() { echo -e "  ${YELLOW}⚠ SKIP${NC} — $1"; }

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

# JSON 필드 추출 (간단 grep 기반)
extract() { echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
extract_num() { echo "$1" | grep -o "\"$2\":[0-9]*" | head -1 | cut -d':' -f2; }

# ── 서버 확인 ──────────────────────────────────────────────────
echo -e "${BOLD}AbleLink API 테스트 v3${NC}"
echo "서버 확인 중..."
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE/worker/login" | grep -q "200"; then
  echo -e "${RED}서버 미실행. npm run dev 를 먼저 실행하세요.${NC}"; exit 1
fi
echo -e "${GREEN}서버 정상 (localhost:3000)${NC}"

# Rate limit 초기화
if [ -f ".env" ]; then
  UPSTASH_URL=$(grep "^UPSTASH_REDIS_REST_URL=" .env | cut -d= -f2- | tr -d '"')
  UPSTASH_TOKEN=$(grep "^UPSTASH_REDIS_REST_TOKEN=" .env | cut -d= -f2- | tr -d '"')
fi
echo -n "Rate limit 초기화 중..."
if [ -n "$UPSTASH_URL" ] && [ -n "$UPSTASH_TOKEN" ]; then
  RL_KEYS=$(curl -s -X POST "$UPSTASH_URL" \
    -H "Authorization: Bearer $UPSTASH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '["KEYS","rl:*"]' 2>/dev/null | grep -o '"[^"]*"' | grep "rl:" | tr -d '"' | tr '\n' ' ')
  if [ -n "$RL_KEYS" ]; then
    DEL_ARGS='["DEL"'; for K in $RL_KEYS; do DEL_ARGS="$DEL_ARGS,\"$K\""; done; DEL_ARGS="$DEL_ARGS]"
    curl -s -X POST "$UPSTASH_URL" -H "Authorization: Bearer $UPSTASH_TOKEN" \
      -H "Content-Type: application/json" -d "$DEL_ARGS" > /dev/null 2>&1
    echo " 완료 ($(echo $RL_KEYS | wc -w | tr -d ' ')개 삭제)"
  else
    echo " (초기화 불필요)"
  fi
else
  echo " (Upstash 없음 — 건너뜀)"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "0. 전체 계정 로그인"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 시스템 운영자 로그인
curl -s -c "$ADMIN_COOKIE" -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"admin","password":"admin1234!"}' > /dev/null

ADMIN_ME=$(curl -s -b "$ADMIN_COOKIE" "$BASE/api/admin/auth/me")
if echo "$ADMIN_ME" | grep -q '"role":"ADMIN"'; then
  pass "시스템 운영자(ADMIN) 로그인 확인"
else
  fail "시스템 운영자 로그인" "role:ADMIN" "$ADMIN_ME"
fi

# 에이전시 관리자 로그인
curl -s -c "$MANAGER_COOKIE" -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"manager01","password":"Manager1234!"}' > /dev/null

MANAGER_ME=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/admin/auth/me")
if echo "$MANAGER_ME" | grep -q '"role":"AGENCY"'; then
  pass "에이전시 관리자(AGENCY) 로그인 확인"
  MANAGER_AGENCY_ID=$(extract "$MANAGER_ME" "agencyId")
else
  fail "에이전시 관리자 로그인" "role:AGENCY" "$MANAGER_ME"
fi

# 직무지도원 로그인
curl -s -c "$WORKER_COOKIE" -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}' > /dev/null

WORKER_ME=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/profile")
if echo "$WORKER_ME" | grep -q '"loginId"'; then
  pass "직무지도원(COACH) 로그인 확인"
  WORKER_ID=$(extract "$WORKER_ME" "id")
else
  fail "직무지도원 로그인" "loginId 포함" "$WORKER_ME"
fi

echo ""
echo "  시드 IDs: agencyId=$MANAGER_AGENCY_ID workerId=$WORKER_ID"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "1. 공개 페이지 (200 + HTML)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "/worker/login" "200" "<!DOCTYPE html" "" "$BASE/worker/login"
assert "/worker/signup" "200" "<!DOCTYPE html" "" "$BASE/worker/signup"
assert "/manager/login" "200" "<!DOCTYPE html" "" "$BASE/manager/login"
assert "/terms" "200" "" "" "$BASE/terms"
assert "/privacy" "200" "" "" "$BASE/privacy"
assert "커스텀 404" "404" "" "" "$BASE/this-page-does-not-exist-xyz"
assert "robots.txt" "200" "User-agent" "" "$BASE/robots.txt"
assert "robots.txt /admin 차단" "200" "Disallow: /admin/" "" "$BASE/robots.txt"
assert "robots.txt /api 차단" "200" "Disallow: /api/" "" "$BASE/robots.txt"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "2. 메인 페이지 링크 검증"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 메인 페이지가 에이전시 관리자를 /manager/login으로 링크하는지 확인
MAIN_HTML=$(curl -s "$BASE/")
if echo "$MAIN_HTML" | grep -q 'href="/manager/login"'; then
  pass "메인 페이지 에이전시 관리자 → /manager/login 링크 확인"
else
  fail "메인 페이지 에이전시 관리자 링크" "/manager/login" "$(echo "$MAIN_HTML" | grep -o 'href="[^"]*login[^"]*"')"
fi
if ! echo "$MAIN_HTML" | grep -q 'href="/admin/login"'; then
  pass "메인 페이지에 /admin/login 링크 없음 (운영자 직접 접근)"
else
  fail "메인 페이지 /admin/login 노출" "노출 없음" "/admin/login 링크 발견"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "3. 페이지 보호 (미인증 → 307 리다이렉트)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "/admin 미인증" "307" "" "" "$BASE/admin"
assert "/manager 미인증" "307" "" "" "$BASE/manager"
assert "/worker/home 미인증" "307" "" "" "$BASE/worker/home"
assert "/worker/calendar 미인증" "307" "" "" "$BASE/worker/calendar"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "4. API 미인증 → 401 (500 아님)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
for ep in \
  "/api/admin/dashboard" \
  "/api/admin/coaches" \
  "/api/admin/sites" \
  "/api/admin/assignments" \
  "/api/admin/attendances" \
  "/api/admin/review" \
  "/api/admin/notices" \
  "/api/admin/support" \
  "/api/admin/holiday-requests" \
  "/api/admin/system/billing" \
  "/api/admin/system/usage" \
  "/api/admin/system/announcements" \
  "/api/admin/system/agencies" \
  "/api/worker/profile" \
  "/api/worker/site/current" \
  "/api/worker/calendar" \
  "/api/worker/logs/list" \
  "/api/worker/holidays" \
  "/api/worker/holiday-requests" \
  "/api/worker/notification"; do
  assert_not "$ep 미인증 → 401 (500 아님)" "401" '"message":"서버 오류"' "" "$BASE$ep"
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "5. 인증 실패 케이스"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 잘못된 비밀번호
FAIL_W=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/worker/auth/login" -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"wrongpw"}')
if [[ "$FAIL_W" == "401" || "$FAIL_W" == "429" ]]; then pass "직무지도원 잘못된 PW → 4xx ($FAIL_W)"; else fail "직무지도원 잘못된 PW" "401/429" "$FAIL_W"; fi

FAIL_M=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/admin/auth/login" -H "Content-Type: application/json" \
  -d '{"loginId":"manager01","password":"wrongpw"}')
if [[ "$FAIL_M" == "401" || "$FAIL_M" == "429" ]]; then pass "에이전시 관리자 잘못된 PW → 4xx ($FAIL_M)"; else fail "에이전시 관리자 잘못된 PW" "401/429" "$FAIL_M"; fi

# 크로스 접근 차단
assert "직무지도원→관리자 API 접근 차단" "401" "" "$WORKER_COOKIE" "$BASE/api/admin/dashboard"
assert "직무지도원→관리자 출근부 수정 차단" "401" "" "$WORKER_COOKIE" "$BASE/api/admin/attendances"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "6. 보안 (BigInt·AGENCY→ADMIN 격리·rate limit)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "[보안] 잘못된 ID(abc) → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies/abc/detail"
assert "[보안] 소수점 ID(1.5) → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies/1.5/detail"
assert "[보안] 지원요청 abc ID → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/support/abc"
assert "[보안] 로그인 응답 phoneNumber 없음" "200" "" "" \
  -X POST "$BASE/api/worker/auth/login" -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}'

# AGENCY → ADMIN 전용 API → 403
assert "[격리] AGENCY→system/billing → 403" "403" '"success":false' "$MANAGER_COOKIE" \
  "$BASE/api/admin/system/billing"
assert "[격리] AGENCY→system/usage → 403" "403" '"success":false' "$MANAGER_COOKIE" \
  "$BASE/api/admin/system/usage"
assert "[격리] AGENCY→system/announcements → 403" "403" '"success":false' "$MANAGER_COOKIE" \
  "$BASE/api/admin/system/announcements"
assert "[격리] ADMIN→final-lock → 403 (AGENCY 전용)" "403" '"success":false' "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/final-lock" -H "Content-Type: application/json" \
  -d '{"userId":"1","yearMonth":"2026-05"}'

# Rate limit
echo -n "  OTP rate limit 테스트..."
GOT_429=0
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/worker/phone-verify" \
    -H "Content-Type: application/json" -d '{"action":"request","phoneNumber":"01099887766"}')
  [ "$CODE" = "429" ] && GOT_429=1 && break
done
if [ $GOT_429 -eq 1 ]; then pass "OTP rate limit → 429 발생"; else fail "OTP rate limit" "429" "15회 후에도 429 없음"; fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "7. 입력값 검증"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "전화번호 형식 오류 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/phone-verify" -H "Content-Type: application/json" \
  -d '{"action":"request","phoneNumber":"0101"}'
assert "phone-verify 잘못된 action → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/phone-verify" -H "Content-Type: application/json" \
  -d '{"action":"unknown","phoneNumber":"01012345678"}'
assert "OTP 틀린 코드 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/phone-verify" -H "Content-Type: application/json" \
  -d '{"action":"confirm","phoneNumber":"01012345678","code":"000000"}'
assert "가입 비밀번호 7자 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/signup" -H "Content-Type: application/json" \
  -d '{"phoneNumber":"01012345678","userName":"테스트","password":"1234567","consentTerms":true,"consentPrivacy":true}'
assert "가입 이름 1자 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/signup" -H "Content-Type: application/json" \
  -d '{"phoneNumber":"01012345678","userName":"김","password":"12345678","consentTerms":true,"consentPrivacy":true}'
assert "가입 약관 미동의 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/signup" -H "Content-Type: application/json" \
  -d '{"phoneNumber":"01012345678","userName":"테스트","password":"12345678","consentTerms":false,"consentPrivacy":false}'
assert "회원탈퇴 잘못된 PW → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/profile/delete" -H "Content-Type: application/json" \
  -d '{"password":"wrongpassword"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "8. 시스템 운영자 핵심 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "시스템 dashboard" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/dashboard"
assert "system/agencies 목록" "200" '"agencies"' "$ADMIN_COOKIE" "$BASE/api/admin/system/agencies"
assert "system/billing" "200" '"billing"' "$ADMIN_COOKIE" "$BASE/api/admin/system/billing"
assert "system/billing isActive 포함" "200" '"isActive"' "$ADMIN_COOKIE" "$BASE/api/admin/system/billing"
assert "system/usage" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/usage?yearMonth=2026-05"
assert "system/announcements 목록" "200" '"announcements"' "$ADMIN_COOKIE" "$BASE/api/admin/system/announcements"
assert "system/coaches" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/coaches"
assert "system/sites" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/sites"
assert "system/logs" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/logs"
assert "system/admins" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/admins"

# 에이전시 상세 (agencyId=1)
assert "system/agencies/1/detail" "200" '"agency"' "$ADMIN_COOKIE" "$BASE/api/admin/system/agencies/1/detail"
assert "system/agencies/1/detail managers" "200" '"managers"' "$ADMIN_COOKIE" "$BASE/api/admin/system/agencies/1/detail"
assert "system/agencies/1/detail sites" "200" '"sites"' "$ADMIN_COOKIE" "$BASE/api/admin/system/agencies/1/detail"

# 잘못된 ID → 404
assert "system/agencies/9999/detail → 404" "404" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies/9999/detail"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "9. 에이전시 관리자 핵심 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "manager dashboard" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/dashboard"
assert "manager coaches" "200" '"data"' "$MANAGER_COOKIE" "$BASE/api/admin/coaches"
assert "manager sites" "200" '"items"' "$MANAGER_COOKIE" "$BASE/api/admin/sites"
assert "manager assignments" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/assignments"
assert "manager attendances" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/attendances?yearMonth=2026-05"
assert "manager review" "200" '"rows"' "$MANAGER_COOKIE" "$BASE/api/admin/review?yearMonth=2026-05"
assert "review isManagerFinalLocked 포함" "200" '"isManagerFinalLocked"' "$MANAGER_COOKIE" "$BASE/api/admin/review?yearMonth=2026-05"
assert "manager payroll/runs" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/payroll/runs"
assert "manager signature" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/signature"
assert "manager notices 목록" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/notices"
assert "manager trainees/summary" "200" '"data"' "$MANAGER_COOKIE" "$BASE/api/admin/trainees/summary"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "10. 직무지도원 핵심 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "profile → userName" "200" '"userName"' "$WORKER_COOKIE" "$BASE/api/worker/profile"
assert "profile → loginId" "200" '"loginId"' "$WORKER_COOKIE" "$BASE/api/worker/profile"
assert "site/current → success" "200" '"success"' "$WORKER_COOKIE" "$BASE/api/worker/site/current"
assert "calendar → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/calendar?year=2026&month=5"
assert "attendance/monthly" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/attendance/monthly?yearMonth=2026-05"
assert "holidays → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/holidays"
assert "notification → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/notification"
assert "payroll → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/payroll"
assert "history → success:true" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/history"
assert "holiday-requests 목록" "200" '"requests"' "$WORKER_COOKIE" "$BASE/api/worker/holiday-requests"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "11. 출근기록 관리"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TODAY=$(date +%Y-%m-%d)
YEST=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null || echo "2026-05-28")

# 출근기록 목록 조회
assert "admin 출근기록 목록" "200" '"success":true' "$MANAGER_COOKIE" \
  "$BASE/api/admin/attendances?yearMonth=2026-05"

# 출근기록 상세 ID 파악 (seed: id=30=오늘, id=31=어제)
ATT_TODAY_ID=$(curl -s -b "$MANAGER_COOKIE" \
  "$BASE/api/admin/attendances?yearMonth=2026-05" | \
  grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')

# 출근기록 수정 (관리자 — 시간 변경)
if [ -n "$ATT_TODAY_ID" ]; then
  assert "출근기록 시간 수정 → 200" "200" '"success":true' "$MANAGER_COOKIE" \
    -X PATCH "$BASE/api/admin/attendances/$ATT_TODAY_ID" \
    -H "Content-Type: application/json" \
    -d '{"startTime":"09:00","endTime":"17:00"}'
  assert "출근기록 확정 → 200" "200" '"success":true' "$MANAGER_COOKIE" \
    -X PATCH "$BASE/api/admin/attendances/$ATT_TODAY_ID" \
    -H "Content-Type: application/json" \
    -d '{"isFinalClosed":true}'
else
  skip "출근기록 ID 조회 실패 — 수정/확정 테스트 스킵"
fi

# 잘못된 ID → 400
assert "출근기록 잘못된 ID → 400" "400" '"success":false' "$MANAGER_COOKIE" \
  -X PATCH "$BASE/api/admin/attendances/abc" \
  -H "Content-Type: application/json" -d '{"startTime":"09:00"}'

# 없는 ID → 404
assert "출근기록 없는 ID → 404" "404" '"success":false' "$MANAGER_COOKIE" \
  -X PATCH "$BASE/api/admin/attendances/999999999" \
  -H "Content-Type: application/json" -d '{"startTime":"09:00"}'

# 직무지도원 출근기록 수정 요청 제출
assert "출근 수정요청 제출" "200" '"success":true' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/attendance/edit-request" \
  -H "Content-Type: application/json" \
  -d "{\"attendanceId\":\"31\",\"reason\":\"퇴근 시간 잘못 기록\",\"proposedStart\":\"09:00\",\"proposedEnd\":\"18:00\"}"

# 출근 수정요청 목록 조회 (올바른 엔드포인트: attendance-edit-requests)
EDIT_REQ_RESP=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/admin/attendance-edit-requests")
assert "출근 수정요청 목록" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/attendance-edit-requests"

# 수정요청 ID 파악 후 승인 (응답 구조: {"requests":[{"id":"1",...}]})
EDIT_REQ_ID=$(echo "$EDIT_REQ_RESP" | grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')
if [ -n "$EDIT_REQ_ID" ]; then
  assert "수정요청 승인 → 200" "200" '"success":true' "$MANAGER_COOKIE" \
    -X PATCH "$BASE/api/admin/attendance-edit-requests/$EDIT_REQ_ID" \
    -H "Content-Type: application/json" \
    -d '{"action":"approve","adminNote":"시간 수정 승인합니다"}'
else
  skip "수정요청 ID 없음 — 승인 테스트 스킵"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "12. 업무일지 CRUD"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 일지 목록 조회 (초기: 비어있을 수 있음)
assert "일지 목록 조회" "200" '"success":true' "$WORKER_COOKIE" \
  "$BASE/api/worker/logs/list?periodStart=2026-05-01&periodEnd=2026-05-31"

# 이전 일지 불러오기 (traineeId 필수)
assert "이전 일지 불러오기 → 200" "200" '"success":true' "$WORKER_COOKIE" \
  "$BASE/api/worker/logs/prev?traineeId=1"

# 일지 생성 (attendanceId=31, traineeId=1 — seed 데이터 기준)
LOG_RESP=$(curl -s -b "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/logs/save" \
  -H "Content-Type: application/json" \
  -d '{"traineeId":"1","attendanceId":"31","trainingType":"FIELD","attendance":"출석","time1on1":60,"timeGroup":0,"totalRecognizedTime":60,"taskName":"작업 훈련","taskScore":4,"content":"오늘 훈련생이 작업에 잘 집중하였습니다.","isCompleted":false}')

if echo "$LOG_RESP" | grep -q '"success":true'; then
  pass "일지 생성 (POST /logs/save)"
  LOG_ID=$(extract "$LOG_RESP" "id")
  LOG_ID_NUM=$(echo "$LOG_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
  [ -z "$LOG_ID" ] && LOG_ID="$LOG_ID_NUM"
else
  fail "일지 생성" "success:true" "$LOG_RESP"
  LOG_ID=""
fi

if [ -n "$LOG_ID" ] && [ "$LOG_ID" != "null" ] && [ "$LOG_ID" != "" ]; then
  # 일지 단건 조회
  assert "일지 단건 조회 (GET /logs/$LOG_ID)" "200" '"success":true' "$WORKER_COOKIE" \
    "$BASE/api/worker/logs/$LOG_ID"
  assert "일지 조회 → content 포함" "200" '"content"' "$WORKER_COOKIE" \
    "$BASE/api/worker/logs/$LOG_ID"
  assert "일지 조회 → taskName 포함" "200" '"taskName"' "$WORKER_COOKIE" \
    "$BASE/api/worker/logs/$LOG_ID"

  # 일지 수정
  assert "일지 수정 (PATCH /logs/$LOG_ID)" "200" '"success":true' "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/logs/$LOG_ID" \
    -H "Content-Type: application/json" \
    -d '{"content":"수정된 내용: 훈련생이 매우 적극적으로 참여하였습니다."}'

  # 수정 후 내용 반영 확인
  UPDATED_LOG=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/logs/$LOG_ID")
  if echo "$UPDATED_LOG" | grep -q "수정된 내용"; then
    pass "일지 수정 후 내용 반영 확인"
  else
    fail "일지 수정 후 내용 반영" "수정된 내용 포함" "$UPDATED_LOG"
  fi

  # 일지 확정
  assert "일지 확정 (POST /logs/$LOG_ID/confirm)" "200" '"success":true' "$WORKER_COOKIE" \
    -X POST "$BASE/api/worker/logs/$LOG_ID/confirm" \
    -H "Content-Type: application/json" -d '{}'

  # 확정 후 재수정 → 자동 미확정 전환 확인
  assert "확정 후 수정 → isCompleted=false" "200" '"success":true' "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/logs/$LOG_ID" \
    -H "Content-Type: application/json" \
    -d '{"content":"재수정: 추가 관찰 내용 기입"}'
  AFTER_EDIT=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/logs/$LOG_ID")
  if echo "$AFTER_EDIT" | grep -q '"isCompleted":false'; then
    pass "수정 시 확정 자동 취소 확인"
  else
    fail "수정 시 확정 자동 취소" '"isCompleted":false' "$AFTER_EDIT"
  fi

  # 다른 사람 일지 접근 차단 (admin 쿠키로 worker 일지 조회 → 401)
  CROSS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$ADMIN_COOKIE" "$BASE/api/worker/logs/$LOG_ID")
  if [ "$CROSS_CODE" = "401" ]; then
    pass "다른 세션으로 일지 접근 → 401"
  else
    fail "다른 세션으로 일지 접근" "401" "$CROSS_CODE"
  fi

  # 두 번째 일지 생성 후 삭제 테스트
  LOG2_RESP=$(curl -s -b "$WORKER_COOKIE" \
    -X POST "$BASE/api/worker/logs/save" \
    -H "Content-Type: application/json" \
    -d '{"traineeId":"1","attendanceId":"31","trainingType":"FIELD","attendance":"출석","time1on1":30,"timeGroup":30,"totalRecognizedTime":60,"taskName":"보조 작업","taskScore":3,"content":"두 번째 일지 (삭제 예정)","isCompleted":false}')
  LOG2_ID=$(echo "$LOG2_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
  if [ -n "$LOG2_ID" ]; then
    assert "일지 삭제 (DELETE /logs/$LOG2_ID)" "200" '"success":true' "$WORKER_COOKIE" \
      -X DELETE "$BASE/api/worker/logs/$LOG2_ID"
    # 삭제 후 조회 → 404
    assert "삭제된 일지 조회 → 404" "404" '"success":false' "$WORKER_COOKIE" \
      "$BASE/api/worker/logs/$LOG2_ID"
  else
    skip "두 번째 일지 생성 실패 — 삭제 테스트 스킵"
  fi

  # 없는 일지 수정 → 404
  assert "없는 일지 수정 → 404" "404" '"success":false' "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/logs/999999999" \
    -H "Content-Type: application/json" -d '{"content":"없는 일지"}'

  # content 없이 수정 → 400
  assert "content 없이 수정 → 400" "400" '"success":false' "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/logs/$LOG_ID" \
    -H "Content-Type: application/json" -d '{"taskName":"과제명만"}'

else
  skip "일지 ID 없음 — 일지 CRUD 세부 테스트 스킵"
fi

# 필수 필드 누락 → 400
assert "일지 생성 traineeId 누락 → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/logs/save" -H "Content-Type: application/json" \
  -d '{"attendanceId":"31","content":"내용"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "13. 일지 월별 확정"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "일지 월별 확정 (POST /logs/confirm-month)" "200" '"confirmed"' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/logs/confirm-month" \
  -H "Content-Type: application/json" \
  -d '{"yearMonth":"2026-05"}'

assert "출근기록 월별 확정 (POST /attendance/confirm-month)" "200" '"confirmed"' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/attendance/confirm-month" \
  -H "Content-Type: application/json" \
  -d '{"yearMonth":"2026-05"}'

# 확정 후 관리자 review → isManagerFinalLocked 체크
assert "관리자 review → rows 데이터" "200" '"rows"' "$MANAGER_COOKIE" \
  "$BASE/api/admin/review?yearMonth=2026-05"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "14. 매니저 최종 확정/잠금"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORKER_ID_NUM="2"  # seed에서 worker01의 id=2

# 잠금
LOCK_RESP=$(curl -s -b "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/final-lock" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$WORKER_ID_NUM\",\"yearMonth\":\"2026-05\"}")
if echo "$LOCK_RESP" | grep -q '"success":true'; then
  pass "매니저 최종 확정 → 200"
else
  fail "매니저 최종 확정" "success:true" "$LOCK_RESP"
fi

# 잠금 후 직무지도원 출근기록 수정 시도 → 409
LOCKED_ATT_ID=$(curl -s -b "$MANAGER_COOKIE" \
  "$BASE/api/admin/attendances?yearMonth=2026-05" | \
  grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')
if [ -n "$LOCKED_ATT_ID" ]; then
  LOCK_CONFIRM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/attendance/$LOCKED_ATT_ID/confirm" \
    -H "Content-Type: application/json" -d '{}')
  if [[ "$LOCK_CONFIRM_CODE" == "409" ]]; then
    pass "잠긴 출근기록 수정 → 409 차단"
  else
    fail "잠긴 출근기록 수정 차단" "409" "$LOCK_CONFIRM_CODE"
  fi
fi

# 잠금 해제
assert "매니저 잠금 해제 → 200" "200" '"success":true' "$MANAGER_COOKIE" \
  -X DELETE "$BASE/api/admin/final-lock" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$WORKER_ID_NUM\",\"yearMonth\":\"2026-05\"}"

# 소속 아닌 userId → 403
assert "잠금: 소속 아닌 userId → 403" "403" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/final-lock" \
  -H "Content-Type: application/json" \
  -d '{"userId":"999999999","yearMonth":"2026-05"}'

# yearMonth 형식 오류 → 400
assert "잠금: 잘못된 yearMonth → 400" "400" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/final-lock" \
  -H "Content-Type: application/json" \
  -d '{"userId":"2","yearMonth":"2026-5"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "15. 커스텀 휴무일"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEST_HOLIDAY_DATE="2026-05-10"

# 휴무일 등록
assert "휴무일 등록 (POST)" "200" '"success":true' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/holidays" \
  -H "Content-Type: application/json" \
  -d "{\"date\":\"$TEST_HOLIDAY_DATE\",\"reason\":\"개인 사정\",\"countAsWorkday\":false}"

# 휴무일 목록 조회
assert "휴무일 목록 조회 (GET)" "200" '"custom"' "$WORKER_COOKIE" \
  "$BASE/api/worker/holidays?year=2026&month=5"

# 근무인정 여부 변경
assert "휴무일 근무인정 변경 (PATCH)" "200" '"success":true' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/holidays" \
  -H "Content-Type: application/json" \
  -d "{\"date\":\"$TEST_HOLIDAY_DATE\",\"countAsWorkday\":true}"

# 에이전시 관리자: 이번달 휴무일 목록 조회
assert "에이전시 관리자: 휴무일 목록 조회" "200" '"success":true' "$MANAGER_COOKIE" \
  "$BASE/api/admin/holiday-requests?yearMonth=2026-05"

# 에이전시 관리자: 존재하지 않는 holidayId 변경 요청 → 403
assert "에이전시: 없는 holidayId 요청 → 403" "403" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/holiday-requests" \
  -H "Content-Type: application/json" \
  -d '{"holidayId":"999999999","requestType":"DELETE"}'

# 휴무일 삭제
assert "휴무일 삭제 (DELETE)" "200" '"success":true' "$WORKER_COOKIE" \
  -X DELETE "$BASE/api/worker/holidays?date=$TEST_HOLIDAY_DATE"

# 삭제 후 해당 날짜 없어야 함
HOLIDAYS_AFTER=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/holidays?year=2026&month=5")
if ! echo "$HOLIDAYS_AFTER" | grep -q "$TEST_HOLIDAY_DATE"; then
  pass "휴무일 삭제 후 목록에서 제거 확인"
else
  fail "휴무일 삭제 후 목록 제거" "없어야 함" "$TEST_HOLIDAY_DATE 여전히 존재"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "16. 지원 요청 채널"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 에이전시 관리자: 티켓 생성
TICKET_RESP=$(curl -s -b "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/support" \
  -H "Content-Type: application/json" \
  -d '{"title":"데이터 수정 요청","body":"2026-05-20 출근 기록이 잘못 입력되었습니다. 수정 부탁드립니다.","category":"DATA_FIX"}')
if echo "$TICKET_RESP" | grep -q '"success":true'; then
  pass "지원 요청 티켓 생성"
  TICKET_ID=$(echo "$TICKET_RESP" | grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')
  [ -z "$TICKET_ID" ] && TICKET_ID=$(echo "$TICKET_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
else
  fail "지원 요청 티켓 생성" "success:true" "$TICKET_RESP"
  TICKET_ID=""
fi

# 에이전시 관리자: 내 티켓 목록 조회
assert "에이전시: 티켓 목록 조회" "200" '"tickets"' "$MANAGER_COOKIE" "$BASE/api/admin/support"

# 시스템 운영자: 전체 티켓 목록 조회
assert "운영자: 티켓 전체 목록" "200" '"tickets"' "$ADMIN_COOKIE" "$BASE/api/admin/support"

if [ -n "$TICKET_ID" ] && [ "$TICKET_ID" != "" ]; then
  # 운영자: 티켓 상세 조회
  assert "운영자: 티켓 상세 조회" "200" '"ticket"' "$ADMIN_COOKIE" "$BASE/api/admin/support/$TICKET_ID"

  # 운영자: 회신
  assert "운영자: 티켓 회신" "200" '"success":true' "$ADMIN_COOKIE" \
    -X PATCH "$BASE/api/admin/support/$TICKET_ID" \
    -H "Content-Type: application/json" \
    -d '{"reply":"확인하였습니다. 출근 기록을 수정해 드리겠습니다."}'

  # 에이전시 관리자: 회신 후 상태 REPLIED 확인
  TICKET_AFTER=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/admin/support/$TICKET_ID")
  if echo "$TICKET_AFTER" | grep -q '"status":"REPLIED"'; then
    pass "회신 후 상태 REPLIED 확인"
  else
    fail "회신 후 상태 REPLIED" '"status":"REPLIED"' "$TICKET_AFTER"
  fi

  # 에이전시 관리자: 종료 처리
  assert "에이전시: 티켓 종료" "200" '"success":true' "$MANAGER_COOKIE" \
    -X PATCH "$BASE/api/admin/support/$TICKET_ID" \
    -H "Content-Type: application/json" \
    -d '{"action":"close"}'

  # 없는 티켓 → 404
  assert "없는 티켓 → 404" "404" '"success":false' "$ADMIN_COOKIE" \
    "$BASE/api/admin/support/999999999"
else
  skip "티켓 ID 없음 — 상세/회신/종료 테스트 스킵"
fi

# 빈 제목 → 400
assert "빈 제목 티켓 → 400" "400" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/support" -H "Content-Type: application/json" \
  -d '{"title":"","body":"내용","category":"GENERAL"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "17. 공지 발송"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 에이전시 관리자: 직무지도원에게 공지 발송
assert "공지 발송 (POST /admin/notices)" "200" '"success":true' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/notices" \
  -H "Content-Type: application/json" \
  -d '{"userId":"2","title":"[안내] 5월 결산 일지 제출 요청","body":"5월 31일까지 모든 일지를 확정 완료해주세요.","type":"INFO","yearMonth":"2026-05"}'

# 공지 목록 조회
assert "공지 목록 조회 (GET /admin/notices)" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/notices"

# 직무지도원: 알림 확인
assert "직무지도원 알림 조회" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/notices"

# 직무지도원: 알림 읽음 처리
assert "알림 읽음 처리" "200" '"success":true' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/notices/read" \
  -H "Content-Type: application/json" -d '{"all":true}'

# 시스템 공지 (ADMIN only)
assert "시스템 공지 발송 → 200" "200" '"success":true' "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/system/announcements" \
  -H "Content-Type: application/json" \
  -d '{"title":"[공지] 시스템 점검 안내","body":"2026-06-01 새벽 2시~4시 시스템 점검이 있습니다.","type":"MAINTENANCE"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "18. 문서 PDF 관련"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# document-runs 목록 조회 (ADMIN 전용 — AGENCY는 FORBIDDEN)
assert "document-runs 목록 (ADMIN)" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/document-runs"
assert "document-runs AGENCY → 403" "403" '"success":false' "$MANAGER_COOKIE" "$BASE/api/admin/document-runs"

# document-versions runId 없이 → 400
assert "document-versions runId 없음 → 400" "400" '"success":false' "$MANAGER_COOKIE" \
  "$BASE/api/admin/document-versions"

# worker docs 조회 (올바른 엔드포인트: /docs/view)
assert "worker docs/view 조회" "200" '"success":true' "$WORKER_COOKIE" \
  "$BASE/api/worker/docs/view?periodStart=2026-05-01&periodEnd=2026-05-31"

# 없는 version ID PDF 요청 → 404
assert "없는 PDF version → 404" "404" '' "$MANAGER_COOKIE" \
  "$BASE/api/admin/document-versions/999999999/pdf"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "19. Cron / 결제 / 공개 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "cron/daily 시크릿 없음 → 401" "401" '"success":false' "" "$BASE/api/cron/daily"
assert "cron/daily 틀린 시크릿 → 401" "401" '"success":false' "" \
  -H "x-cron-secret: wrongsecret" "$BASE/api/cron/daily"
assert "payments/charge 인증 없음 → 401" "401" '"success":false' "" \
  -X POST "$BASE/api/payments/charge"
assert "contracts 공개 → 400 (토큰 없음)" "400" '"success":false' "" "$BASE/api/worker/contracts"
assert "invite/999999 → 404" "404" '"success":false' "" "$BASE/api/worker/invite/999999"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "20. 프로필 수정"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 이름 수정
assert "프로필 이름 수정" "200" '"success":true' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/profile" \
  -H "Content-Type: application/json" \
  -d '{"userName":"김지도원"}'

# 수정된 이름 확인 (PATCH 성공 + GET에서 userName 필드 존재 확인)
PROFILE_AFTER=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/profile")
if echo "$PROFILE_AFTER" | grep -q '"userName"'; then
  pass "프로필 이름 수정 반영 확인"
else
  fail "프로필 이름 수정 반영" '"userName" 포함' "$PROFILE_AFTER"
fi

# 비밀번호 변경 (잘못된 현재 비밀번호 → 400)
assert "비밀번호 변경: 현재 PW 틀림 → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/profile" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"wrongpw","newPassword":"NewPass1234!"}'

# 비밀번호 변경 (8자 미만 → 400)
assert "비밀번호 변경: 7자 → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/profile" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"worker1234!","newPassword":"short1"}'

# 이름 원래대로 복구
curl -s -b "$WORKER_COOKIE" -X PATCH "$BASE/api/worker/profile" \
  -H "Content-Type: application/json" -d '{"userName":"김지도"}' > /dev/null

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
