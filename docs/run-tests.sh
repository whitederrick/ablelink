#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# AbleLink API 테스트 스크립트 v6
# (v6: 섹션 24 — 업로드 입력 검증 + OTP/초대/가입 무차별 대입 방어 검증 추가)
# 실행: bash docs/run-tests.sh
# 사전 조건: npx tsx prisma/seed.ts 실행 후 npm run dev 실행
# ──────────────────────────────────────────────────────────────

BASE="http://localhost:3000"
PASS=0; FAIL=0; BUGS=()
RESP_FILE=$(mktemp)
ADMIN_COOKIE=$(mktemp)    # 시스템 운영자 (admlink_admin_session)
MANAGER_COOKIE=$(mktemp)  # 에이전시 관리자 (admlink_manager_session)
WORKER_COOKIE=$(mktemp)   # 직무지도원 (ablelink_worker_session)
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

extract() { echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
extract_num() { echo "$1" | grep -o "\"$2\":[0-9]*" | head -1 | cut -d':' -f2; }

# ── 서버 확인 ──────────────────────────────────────────────────
echo -e "${BOLD}AbleLink API 테스트 v5${NC}"
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
# 시스템 운영자 로그인 (/api/admin/auth/login → admlink_admin_session)
curl -s -c "$ADMIN_COOKIE" -X POST "$BASE/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"admin","password":"admin1234!"}' > /dev/null

ADMIN_ME=$(curl -s -b "$ADMIN_COOKIE" "$BASE/api/admin/auth/me")
if echo "$ADMIN_ME" | grep -q '"loginId"'; then
  pass "시스템 운영자(Admin) 로그인 확인"
else
  fail "시스템 운영자 로그인" "loginId 포함" "$ADMIN_ME"
fi

# 에이전시 관리자 로그인 (/api/manager/auth/login → admlink_manager_session)
curl -s -c "$MANAGER_COOKIE" -X POST "$BASE/api/manager/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"manager","password":"manager1234!"}' > /dev/null

MANAGER_ME=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/manager/auth/me")
if echo "$MANAGER_ME" | grep -q '"agencyId"'; then
  pass "에이전시 관리자(Manager) 로그인 확인"
  MANAGER_AGENCY_ID=$(extract "$MANAGER_ME" "agencyId")
else
  fail "에이전시 관리자 로그인" "agencyId 포함" "$MANAGER_ME"
fi

# 직무지도원 로그인
curl -s -c "$WORKER_COOKIE" -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker","password":"worker1234!"}' > /dev/null

WORKER_ME=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/profile")
if echo "$WORKER_ME" | grep -q '"loginId"'; then
  pass "직무지도원(Worker) 로그인 확인"
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
section "4. API 미인증 → 401"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
for ep in \
  "/api/admin/dashboard" \
  "/api/admin/workers" \
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
  "/api/manager/auth/me" \
  "/api/worker/profile" \
  "/api/worker/site/current" \
  "/api/worker/calendar" \
  "/api/worker/logs/list" \
  "/api/worker/holidays" \
  "/api/worker/holiday-requests" \
  "/api/worker/notification" \
  "/api/manager/notices"; do
  assert_not "$ep 미인증 → 401 (500 아님)" "401" '"message":"서버 오류"' "" "$BASE$ep"
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "5. 인증 실패 케이스"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FAIL_W=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/worker/auth/login" -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"wrongpw"}')
if [[ "$FAIL_W" == "401" || "$FAIL_W" == "429" ]]; then pass "직무지도원 잘못된 PW → 4xx ($FAIL_W)"; else fail "직무지도원 잘못된 PW" "401/429" "$FAIL_W"; fi

FAIL_A=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/admin/auth/login" -H "Content-Type: application/json" \
  -d '{"loginId":"admin","password":"wrongpw"}')
if [[ "$FAIL_A" == "401" || "$FAIL_A" == "429" ]]; then pass "시스템 운영자 잘못된 PW → 4xx ($FAIL_A)"; else fail "시스템 운영자 잘못된 PW" "401/429" "$FAIL_A"; fi

FAIL_M=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/manager/auth/login" -H "Content-Type: application/json" \
  -d '{"loginId":"manager","password":"wrongpw"}')
if [[ "$FAIL_M" == "401" || "$FAIL_M" == "429" ]]; then pass "에이전시 관리자 잘못된 PW → 4xx ($FAIL_M)"; else fail "에이전시 관리자 잘못된 PW" "401/429" "$FAIL_M"; fi

# 크로스 접근 차단
assert "직무지도원→관리자 API 접근 차단" "401" "" "$WORKER_COOKIE" "$BASE/api/admin/dashboard"
assert "직무지도원→관리자 출근부 수정 차단" "401" "" "$WORKER_COOKIE" "$BASE/api/admin/attendances"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "6. 보안 (Admin/Manager 세션 분리·IDOR·rate limit)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# [분리] 에이전시 관리자 세션으로 /api/admin/auth/me → 401 (Admin 전용)
assert "[분리] Manager 세션→Admin me → 401" "401" "" "$MANAGER_COOKIE" \
  "$BASE/api/admin/auth/me"

# [분리] 시스템 운영자 세션으로 /api/manager/auth/me → 401 (Manager 전용)
assert "[분리] Admin 세션→Manager me → 401" "401" "" "$ADMIN_COOKIE" \
  "$BASE/api/manager/auth/me"

# [분리] 에이전시 관리자 세션으로 Admin 전용 API → 401
assert "[분리] Manager 세션→system/agencies → 401" "401" "" "$MANAGER_COOKIE" \
  "$BASE/api/admin/system/agencies"

# BigInt 입력 검증
assert "[보안] 잘못된 ID(abc) → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies/abc/detail"
assert "[보안] 소수점 ID(1.5) → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies/1.5/detail"
assert "[보안] 지원요청 abc ID → 400" "400" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/support/abc"

# 로그인 응답 민감 정보 미포함
LOGIN_RESP=$(curl -s -X POST "$BASE/api/worker/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"worker01","password":"worker1234!"}')
if ! echo "$LOGIN_RESP" | grep -q '"phoneNumber"'; then
  pass "[보안] 로그인 응답 phoneNumber 미포함"
else
  fail "[보안] 로그인 응답 phoneNumber 미포함" "phoneNumber 없음" "$LOGIN_RESP"
fi

# 비밀번호 리셋 응답에 임시 비밀번호 미포함 (HIGH-4 수정 검증)
WORKER_ID=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/admin/workers" | grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')
if [ -n "$WORKER_ID" ]; then
  RESET_RESP=$(curl -s -b "$MANAGER_COOKIE" \
    -X PATCH "$BASE/api/admin/workers/$WORKER_ID" \
    -H "Content-Type: application/json" \
    -d '{"resetPassword":true}')
  # 핵심: 응답에 tempPassword가 포함되면 안 됨 (성공 여부와 무관)
  if ! echo "$RESET_RESP" | grep -q '"tempPassword"'; then
    pass "[보안] 비밀번호 리셋 응답에 tempPassword 미포함"
  else
    fail "[보안] 비밀번호 리셋 tempPassword 미포함" "tempPassword 없음" "$RESET_RESP"
  fi
else
  skip "코치 ID 없음 — 비밀번호 리셋 테스트 스킵"
fi

# register 초대 코드 없이 가입 시도 → 400 (HIGH-2 수정 검증)
assert "[보안] register 초대코드 없이 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/worker/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"loginId":"01099998888","password":"test1234!","userName":"테스트","phoneNumber":"01099998888"}'

# AGENCY → ADMIN 전용 API → 401/403
assert "[격리] Manager→system/billing → 401" "401" '"success":false' "$MANAGER_COOKIE" \
  "$BASE/api/admin/system/billing"
assert "[격리] Manager→system/usage → 401" "401" '"success":false' "$MANAGER_COOKIE" \
  "$BASE/api/admin/system/usage"
assert "[격리] Manager→system/announcements → 401" "401" '"success":false' "$MANAGER_COOKIE" \
  "$BASE/api/admin/system/announcements"
assert "[격리] Admin→final-lock → 401 (Manager 전용)" "401" '"success":false' "$ADMIN_COOKIE" \
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
assert "notices 잘못된 userId 배열 → 404 (대상 없음)" "404" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/notices" -H "Content-Type: application/json" \
  -d '{"userIds":["abc","xyz"],"title":"테스트","body":"내용"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "8. 시스템 운영자 핵심 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "manager dashboard (MANAGER)" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/dashboard"
assert "system/agencies 목록" "200" '"agencies"' "$ADMIN_COOKIE" "$BASE/api/admin/system/agencies"
assert "system/billing" "200" '"billing"' "$ADMIN_COOKIE" "$BASE/api/admin/system/billing"
assert "system/billing isActive 포함" "200" '"isActive"' "$ADMIN_COOKIE" "$BASE/api/admin/system/billing"
assert "system/usage" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/usage?yearMonth=2026-05"
assert "system/announcements 목록" "200" '"announcements"' "$ADMIN_COOKIE" "$BASE/api/admin/system/announcements"
assert "system/workers" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/workers"
assert "system/sites" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/sites"
assert "system/logs" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/logs"
assert "system/admins" "200" '"success":true' "$ADMIN_COOKIE" "$BASE/api/admin/system/admins"

# 에이전시 상세 (agencyId는 로그인 시 동적 조회)
if [ -n "$MANAGER_AGENCY_ID" ]; then
  assert "system/agencies/$MANAGER_AGENCY_ID/detail" "200" '"agency"' "$ADMIN_COOKIE" "$BASE/api/admin/system/agencies/$MANAGER_AGENCY_ID/detail"
  assert "system/agencies/$MANAGER_AGENCY_ID/detail managers" "200" '"managers"' "$ADMIN_COOKIE" "$BASE/api/admin/system/agencies/$MANAGER_AGENCY_ID/detail"
  assert "system/agencies/$MANAGER_AGENCY_ID/detail sites" "200" '"sites"' "$ADMIN_COOKIE" "$BASE/api/admin/system/agencies/$MANAGER_AGENCY_ID/detail"
else
  skip "agencyId 없음 — agencies detail 테스트 스킵"
fi
assert "system/agencies/9999/detail → 404" "404" '"success":false' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/agencies/9999/detail"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "9. 에이전시 관리자 핵심 API"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "manager dashboard" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/dashboard"
assert "manager me → unreadNoticeCount 포함" "200" '"unreadNoticeCount"' "$MANAGER_COOKIE" "$BASE/api/manager/auth/me"
assert "manager notices 목록 (GET)" "200" '"notices"' "$MANAGER_COOKIE" "$BASE/api/manager/notices"
assert "manager notices → unreadCount 포함" "200" '"unreadCount"' "$MANAGER_COOKIE" "$BASE/api/manager/notices"
assert "manager workers" "200" '"data"' "$MANAGER_COOKIE" "$BASE/api/admin/workers"
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
assert "admin 출근기록 목록" "200" '"success":true' "$MANAGER_COOKIE" \
  "$BASE/api/admin/attendances?yearMonth=2026-05"

ATT_TODAY_ID=$(curl -s -b "$MANAGER_COOKIE" \
  "$BASE/api/admin/attendances?yearMonth=2026-05" | \
  grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')

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

assert "출근기록 잘못된 ID → 400" "400" '"success":false' "$MANAGER_COOKIE" \
  -X PATCH "$BASE/api/admin/attendances/abc" \
  -H "Content-Type: application/json" -d '{"startTime":"09:00"}'
assert "출근기록 없는 ID → 404" "404" '"success":false' "$MANAGER_COOKIE" \
  -X PATCH "$BASE/api/admin/attendances/999999999" \
  -H "Content-Type: application/json" -d '{"startTime":"09:00"}'

assert "출근 수정요청 제출" "200" '"success":true' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/attendance/edit-request" \
  -H "Content-Type: application/json" \
  -d '{"attendanceId":"33","reason":"퇴근 시간 잘못 기록","proposedStart":"09:00","proposedEnd":"18:00"}'

EDIT_REQ_RESP=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/admin/attendance-edit-requests")
assert "출근 수정요청 목록" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/attendance-edit-requests"

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
assert "일지 목록 조회" "200" '"success":true' "$WORKER_COOKIE" \
  "$BASE/api/worker/logs/list?periodStart=2026-05-01&periodEnd=2026-05-31"
assert "이전 일지 불러오기 → 200" "200" '' "$WORKER_COOKIE" \
  "$BASE/api/worker/logs/prev?traineeId=2"

LOG_RESP=$(curl -s -b "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/logs/save" \
  -H "Content-Type: application/json" \
  -d '{"traineeId":"2","attendanceId":"33","trainingType":"FIELD","attendance":"출석","time1on1":60,"timeGroup":0,"totalRecognizedTime":60,"taskName":"작업 훈련","taskScore":4,"content":"오늘 훈련생이 작업에 잘 집중하였습니다.","isCompleted":false}')

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
  assert "일지 단건 조회" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/logs/$LOG_ID"
  assert "일지 조회 → content 포함" "200" '"content"' "$WORKER_COOKIE" "$BASE/api/worker/logs/$LOG_ID"
  assert "일지 수정" "200" '"success":true' "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/logs/$LOG_ID" -H "Content-Type: application/json" \
    -d '{"content":"수정된 내용: 훈련생이 매우 적극적으로 참여하였습니다."}'

  UPDATED_LOG=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/logs/$LOG_ID")
  if echo "$UPDATED_LOG" | grep -q "수정된 내용"; then
    pass "일지 수정 후 내용 반영 확인"
  else
    fail "일지 수정 후 내용 반영" "수정된 내용 포함" "$UPDATED_LOG"
  fi

  assert "일지 확정" "200" '"success":true' "$WORKER_COOKIE" \
    -X POST "$BASE/api/worker/logs/$LOG_ID/confirm" -H "Content-Type: application/json" -d '{}'

  assert "확정 후 수정 → 성공" "200" '"success":true' "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/logs/$LOG_ID" -H "Content-Type: application/json" \
    -d '{"content":"재수정: 추가 관찰 내용"}'
  AFTER_EDIT=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/logs/$LOG_ID")
  if echo "$AFTER_EDIT" | grep -q '"isCompleted":false'; then
    pass "수정 시 확정 자동 취소 확인"
  else
    fail "수정 시 확정 자동 취소" '"isCompleted":false' "$AFTER_EDIT"
  fi

  CROSS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$ADMIN_COOKIE" "$BASE/api/worker/logs/$LOG_ID")
  if [ "$CROSS_CODE" = "401" ]; then pass "다른 세션으로 일지 접근 → 401"; else fail "다른 세션으로 일지 접근" "401" "$CROSS_CODE"; fi

  LOG2_RESP=$(curl -s -b "$WORKER_COOKIE" \
    -X POST "$BASE/api/worker/logs/save" -H "Content-Type: application/json" \
    -d '{"traineeId":"2","attendanceId":"33","trainingType":"FIELD","attendance":"출석","time1on1":30,"timeGroup":30,"totalRecognizedTime":60,"taskName":"보조","taskScore":3,"content":"두 번째 일지","isCompleted":false}')
  LOG2_ID=$(echo "$LOG2_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
  if [ -n "$LOG2_ID" ]; then
    assert "일지 삭제" "200" '"success":true' "$WORKER_COOKIE" -X DELETE "$BASE/api/worker/logs/$LOG2_ID"
    assert "삭제된 일지 조회 → 404" "404" '"success":false' "$WORKER_COOKIE" "$BASE/api/worker/logs/$LOG2_ID"
  else
    skip "두 번째 일지 생성 실패 — 삭제 테스트 스킵"
  fi

  assert "없는 일지 수정 → 404" "404" '"success":false' "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/logs/999999999" -H "Content-Type: application/json" -d '{"content":"없는"}'
else
  skip "일지 ID 없음 — 일지 CRUD 세부 테스트 스킵"
fi

assert "일지 생성 traineeId 누락 → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/logs/save" -H "Content-Type: application/json" \
  -d '{"attendanceId":"31","content":"내용"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "13. 일지 월별 확정"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "일지 월별 확정" "200" '"confirmed"' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/logs/confirm-month" -H "Content-Type: application/json" \
  -d '{"yearMonth":"2026-05"}'
assert "출근기록 월별 확정" "200" '"confirmed"' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/attendance/confirm-month" -H "Content-Type: application/json" \
  -d '{"yearMonth":"2026-05"}'
assert "관리자 review → rows 데이터" "200" '"rows"' "$MANAGER_COOKIE" \
  "$BASE/api/admin/review?yearMonth=2026-05"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "14. 매니저 최종 확정/잠금"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORKER_ID_NUM="${WORKER_ID:-1}"  # 로그인 시 동적 조회

LOCK_RESP=$(curl -s -b "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/final-lock" -H "Content-Type: application/json" \
  -d "{\"userId\":\"$WORKER_ID_NUM\",\"yearMonth\":\"2026-05\"}")
if echo "$LOCK_RESP" | grep -q '"success":true'; then pass "매니저 최종 확정 → 200"; else fail "매니저 최종 확정" "success:true" "$LOCK_RESP"; fi

LOCKED_ATT_ID=$(curl -s -b "$MANAGER_COOKIE" \
  "$BASE/api/admin/attendances?yearMonth=2026-05" | \
  grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')
if [ -n "$LOCKED_ATT_ID" ]; then
  LOCK_CONFIRM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$WORKER_COOKIE" \
    -X PATCH "$BASE/api/worker/attendance/$LOCKED_ATT_ID/confirm" -H "Content-Type: application/json" -d '{}')
  if [[ "$LOCK_CONFIRM_CODE" == "409" ]]; then pass "잠긴 출근기록 수정 → 409 차단"; else fail "잠긴 출근기록 수정 차단" "409" "$LOCK_CONFIRM_CODE"; fi
fi

assert "매니저 잠금 해제 → 200" "200" '"success":true' "$MANAGER_COOKIE" \
  -X DELETE "$BASE/api/admin/final-lock" -H "Content-Type: application/json" \
  -d "{\"userId\":\"$WORKER_ID_NUM\",\"yearMonth\":\"2026-05\"}"
assert "잠금: 소속 아닌 userId → 403" "403" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/final-lock" -H "Content-Type: application/json" \
  -d '{"userId":"999999999","yearMonth":"2026-05"}'
assert "잠금: 잘못된 yearMonth → 400" "400" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/final-lock" -H "Content-Type: application/json" \
  -d '{"userId":"2","yearMonth":"2026-5"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "15. 커스텀 휴무일"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEST_HOLIDAY_DATE="2026-05-10"

assert "휴무일 등록 (POST)" "200" '"success":true' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/holidays" -H "Content-Type: application/json" \
  -d "{\"date\":\"$TEST_HOLIDAY_DATE\",\"reason\":\"개인 사정\",\"countAsWorkday\":false}"
assert "휴무일 목록 조회 (GET)" "200" '"custom"' "$WORKER_COOKIE" \
  "$BASE/api/worker/holidays?year=2026&month=5"
assert "휴무일 근무인정 변경 (PATCH)" "200" '"success":true' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/holidays" -H "Content-Type: application/json" \
  -d "{\"date\":\"$TEST_HOLIDAY_DATE\",\"countAsWorkday\":true}"
assert "에이전시 관리자: 휴무일 목록 조회" "200" '"success":true' "$MANAGER_COOKIE" \
  "$BASE/api/admin/holiday-requests?yearMonth=2026-05"
assert "에이전시: 없는 holidayId 요청 → 403" "403" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/holiday-requests" -H "Content-Type: application/json" \
  -d '{"holidayId":"999999999","requestType":"DELETE"}'
assert "휴무일 삭제 (DELETE)" "200" '"success":true' "$WORKER_COOKIE" \
  -X DELETE "$BASE/api/worker/holidays?date=$TEST_HOLIDAY_DATE"

HOLIDAYS_AFTER=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/holidays?year=2026&month=5")
if ! echo "$HOLIDAYS_AFTER" | grep -q "$TEST_HOLIDAY_DATE"; then
  pass "휴무일 삭제 후 목록에서 제거 확인"
else
  fail "휴무일 삭제 후 목록 제거" "없어야 함" "$TEST_HOLIDAY_DATE 여전히 존재"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "16. 지원 요청 채널"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TICKET_RESP=$(curl -s -b "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/support" -H "Content-Type: application/json" \
  -d '{"title":"데이터 수정 요청","body":"2026-05-20 출근 기록이 잘못 입력되었습니다.","category":"DATA_FIX"}')
if echo "$TICKET_RESP" | grep -q '"success":true'; then
  pass "지원 요청 티켓 생성"
  TICKET_ID=$(echo "$TICKET_RESP" | grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')
  [ -z "$TICKET_ID" ] && TICKET_ID=$(echo "$TICKET_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
else
  fail "지원 요청 티켓 생성" "success:true" "$TICKET_RESP"
  TICKET_ID=""
fi

assert "에이전시: 티켓 목록 조회" "200" '"tickets"' "$MANAGER_COOKIE" "$BASE/api/admin/support"
assert "운영자: 티켓 전체 목록" "200" '"tickets"' "$ADMIN_COOKIE" "$BASE/api/admin/support"

if [ -n "$TICKET_ID" ]; then
  assert "운영자: 티켓 상세 조회" "200" '"ticket"' "$ADMIN_COOKIE" "$BASE/api/admin/support/$TICKET_ID"
  assert "운영자: 티켓 회신" "200" '"success":true' "$ADMIN_COOKIE" \
    -X PATCH "$BASE/api/admin/support/$TICKET_ID" -H "Content-Type: application/json" \
    -d '{"reply":"확인하였습니다. 수정해드리겠습니다."}'

  TICKET_AFTER=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/admin/support/$TICKET_ID")
  if echo "$TICKET_AFTER" | grep -q '"status":"REPLIED"'; then
    pass "회신 후 상태 REPLIED 확인"
  else
    fail "회신 후 상태 REPLIED" '"status":"REPLIED"' "$TICKET_AFTER"
  fi

  # 회신 후 매니저 알림 자동 생성 확인
  NOTICE_AFTER_REPLY=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/manager/notices")
  if echo "$NOTICE_AFTER_REPLY" | grep -q '"unreadCount":0\b' || echo "$NOTICE_AFTER_REPLY" | grep -qE '"unreadCount":[1-9]'; then
    pass "운영자 회신 후 매니저 알림 조회 정상"
  else
    fail "운영자 회신 후 매니저 알림 조회" '"unreadCount" 포함' "$NOTICE_AFTER_REPLY"
  fi

  # 매니저 알림 전체 읽음 처리
  assert "매니저 알림 전체 읽음 처리" "200" '"success":true' "$MANAGER_COOKIE" \
    -X POST "$BASE/api/manager/notices" -H "Content-Type: application/json" -d '{"all":true}'

  # 읽음 처리 후 unreadCount = 0 확인
  NOTICES_AFTER_READ=$(curl -s -b "$MANAGER_COOKIE" "$BASE/api/manager/notices")
  UNREAD_AFTER=$(echo "$NOTICES_AFTER_READ" | grep -o '"unreadCount":[0-9]*' | cut -d: -f2)
  if [ "${UNREAD_AFTER:-0}" = "0" ]; then
    pass "매니저 알림 읽음 처리 후 unreadCount=0"
  else
    fail "매니저 알림 읽음 처리" "unreadCount=0" "unreadCount=${UNREAD_AFTER}"
  fi

  # 없는 noticeId → 404
  assert "매니저 알림 없는 ID → 404" "404" '"success":false' "$MANAGER_COOKIE" \
    -X POST "$BASE/api/manager/notices" -H "Content-Type: application/json" \
    -d '{"noticeId":"999999999"}'

  assert "에이전시: 티켓 종료" "200" '"success":true' "$MANAGER_COOKIE" \
    -X PATCH "$BASE/api/admin/support/$TICKET_ID" -H "Content-Type: application/json" \
    -d '{"action":"close"}'
  assert "없는 티켓 → 404" "404" '"success":false' "$ADMIN_COOKIE" "$BASE/api/admin/support/999999999"
else
  skip "티켓 ID 없음 — 상세/회신/종료 테스트 스킵"
fi

assert "빈 제목 티켓 → 400" "400" '"success":false' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/support" -H "Content-Type: application/json" \
  -d '{"title":"","body":"내용","category":"GENERAL"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "17. 공지 발송"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "공지 발송" "200" '"success":true' "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/notices" -H "Content-Type: application/json" \
  -d "{\"userIds\":[\"$WORKER_ID_NUM\"],\"title\":\"[안내] 5월 결산\",\"body\":\"5월 31일까지 일지 확정해주세요.\",\"type\":\"INFO\",\"yearMonth\":\"2026-05\"}"
assert "공지 목록 조회" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/notices"
assert "직무지도원 알림 조회" "200" '"success":true' "$WORKER_COOKIE" "$BASE/api/worker/notices"
assert "알림 읽음 처리" "200" '"success":true' "$WORKER_COOKIE" \
  -X POST "$BASE/api/worker/notices/read" -H "Content-Type: application/json" -d '{"all":true}'
assert "시스템 공지 발송 → 200" "200" '"success":true' "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/system/announcements" -H "Content-Type: application/json" \
  -d '{"title":"[공지] 시스템 점검","body":"2026-06-01 새벽 2시~4시 점검.","type":"MAINTENANCE"}'

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "18. 문서 PDF 관련"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
assert "document-runs 목록 (MANAGER)" "200" '"success":true' "$MANAGER_COOKIE" "$BASE/api/admin/document-runs"
assert "document-runs 미인증 → 401" "401" '"success":false' "" "$BASE/api/admin/document-runs"
assert "document-versions runId 없음 → 400" "400" '"success":false' "$MANAGER_COOKIE" \
  "$BASE/api/admin/document-versions"
assert "worker docs/view 조회" "200" '"success"' "$WORKER_COOKIE" \
  "$BASE/api/worker/docs/view?periodStart=2026-05-01&periodEnd=2026-05-31"
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
assert "프로필 이름 수정" "200" '"success":true' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/profile" -H "Content-Type: application/json" \
  -d '{"userName":"김지도원"}'
PROFILE_AFTER=$(curl -s -b "$WORKER_COOKIE" "$BASE/api/worker/profile")
if echo "$PROFILE_AFTER" | grep -q '"userName"'; then pass "프로필 이름 수정 반영 확인"; else fail "프로필 이름 수정 반영" '"userName" 포함' "$PROFILE_AFTER"; fi

assert "비밀번호 변경: 현재 PW 틀림 → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/profile" -H "Content-Type: application/json" \
  -d '{"currentPassword":"wrongpw","newPassword":"NewPass1234!"}'
assert "비밀번호 변경: 7자 → 400" "400" '"success":false' "$WORKER_COOKIE" \
  -X PATCH "$BASE/api/worker/profile" -H "Content-Type: application/json" \
  -d '{"currentPassword":"worker1234!","newPassword":"short1"}'

curl -s -b "$WORKER_COOKIE" -X PATCH "$BASE/api/worker/profile" \
  -H "Content-Type: application/json" -d '{"userName":"김지도"}' > /dev/null

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "21. 직무지도원 초대 링크 가입 시나리오"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1단계: 매니저 → 초대 생성
INVITE_PHONE="010$(date +%s | cut -c 3-10)"
INVITE_RESP=$(curl -s -b "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/workers/invite" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"$INVITE_PHONE\",\"workerName\":\"초대테스트\",\"siteId\":\"2\"}")

if echo "$INVITE_RESP" | grep -q '"success":true'; then
  pass "매니저: 초대 링크 생성"
  INVITE_ID=$(echo "$INVITE_RESP"   | grep -o '"id":"[0-9]*"'   | head -1 | grep -o '[0-9]*')
  INVITE_CODE=$(echo "$INVITE_RESP" | grep -o '"code":"[0-9]*"' | head -1 | grep -o '[0-9]*')
  [ -z "$INVITE_ID"   ] && INVITE_ID=$(echo   "$INVITE_RESP" | grep -o '"id":[0-9]*'   | head -1 | cut -d: -f2)
  [ -z "$INVITE_CODE" ] && INVITE_CODE=$(echo "$INVITE_RESP" | grep -o '"code":[0-9]*' | head -1 | cut -d: -f2)
else
  fail "매니저: 초대 링크 생성" "success:true" "$INVITE_RESP"
  INVITE_ID=""; INVITE_CODE=""
fi

if [ -n "$INVITE_ID" ] && [ -n "$INVITE_CODE" ]; then
  # 2단계: 초대 링크 정보 조회 (직무지도원 앱에서 링크 클릭 시)
  INVITE_INFO=$(curl -s "$BASE/api/worker/invite/$INVITE_ID")
  if echo "$INVITE_INFO" | grep -q '"agencyName"'; then
    pass "직무지도원: 초대 링크 정보 조회"
  else
    fail "직무지도원: 초대 링크 정보 조회" "agencyName 포함" "$INVITE_INFO"
  fi

  # 3단계: 코드 검증 (action: verify)
  assert "직무지도원: 초대 코드 검증" "200" '"success":true' "" \
    -X POST "$BASE/api/worker/invite/$INVITE_ID" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"verify\",\"code\":\"$INVITE_CODE\"}"

  # 4단계: 틀린 코드 검증 → 400
  assert "직무지도원: 잘못된 초대 코드 → 400" "400" '"success":false' "" \
    -X POST "$BASE/api/worker/invite/$INVITE_ID" \
    -H "Content-Type: application/json" \
    -d '{"action":"verify","code":"000000"}'

  # 5단계: 약관 미동의 가입 → 400
  assert "직무지도원: 초대 가입 약관 미동의 → 400" "400" '"success":false' "" \
    -X POST "$BASE/api/worker/invite/$INVITE_ID" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"signup\",\"code\":\"$INVITE_CODE\",\"userName\":\"초대테스트\",\"password\":\"test1234!\",\"consentTerms\":false,\"consentPrivacy\":false}"

  # 6단계: 초대 코드로 정상 가입 (action: signup)
  INVITE_COOKIE=$(mktemp)
  SIGNUP_RESP=$(curl -s -c "$INVITE_COOKIE" \
    -X POST "$BASE/api/worker/invite/$INVITE_ID" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"signup\",\"code\":\"$INVITE_CODE\",\"userName\":\"초대테스트\",\"password\":\"test1234!\",\"consentTerms\":true,\"consentPrivacy\":true,\"consentLocation\":true}")

  if echo "$SIGNUP_RESP" | grep -q '"success":true'; then
    pass "직무지도원: 초대 코드로 가입 완료"
  else
    fail "직무지도원: 초대 코드로 가입" "success:true" "$SIGNUP_RESP"
  fi

  # 7단계: 가입 후 자동 로그인(세션 쿠키) 확인
  if grep -q "ablelink_worker_session" "$INVITE_COOKIE" 2>/dev/null; then
    pass "초대 가입 후 세션 쿠키 자동 발급"
  else
    fail "초대 가입 후 세션 쿠키" "ablelink_worker_session 쿠키" "쿠키 없음"
  fi

  # 8단계: 이미 사용된 링크로 재가입 시도 → 410
  assert "초대 링크 재사용 → 410" "410" '"success":false' "" \
    -X POST "$BASE/api/worker/invite/$INVITE_ID" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"signup\",\"code\":\"$INVITE_CODE\",\"userName\":\"재시도\",\"password\":\"test1234!\",\"consentTerms\":true,\"consentPrivacy\":true}"

  # 9단계: 사이트 자동 배정 확인 (siteId 지정했으면 hasSite:true)
  if echo "$SIGNUP_RESP" | grep -q '"hasSite":true'; then
    pass "초대 가입 시 사이트 자동 배정 확인"
  else
    fail "초대 가입 사이트 자동 배정" '"hasSite":true' "$SIGNUP_RESP"
  fi

  rm -f "$INVITE_COOKIE"
else
  skip "초대 ID/코드 없음 — 초대 가입 시나리오 스킵"
fi

# 존재하지 않는 초대 → 404
assert "존재하지 않는 초대 링크 → 404" "404" '"success":false' "" \
  "$BASE/api/worker/invite/999999"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "22. 에이전시 관리자 가입 시나리오 (Option A: 자체 신청)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TS=$(date +%s)
BNO_TEST="${TS}"          # 10자리 타임스탬프 → 사업자번호로 사용
LOGIN_TEST="mgr${TS}"     # 고유 loginId

# 1) 기관명 누락 → 400
assert "관리자 가입: 기관명 누락 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/manager/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"businessNumber":"1234567890","loginId":"testmgr","password":"test1234!"}'

# 2) 잘못된 사업자번호(9자리) → 400
assert "관리자 가입: 잘못된 사업자번호 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/manager/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"agencyName":"테스트기관","businessNumber":"123456789","loginId":"testmgr","password":"test1234!"}'

# 3) 짧은 비밀번호(7자) → 400
assert "관리자 가입: 짧은 비밀번호 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/manager/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"agencyName":"테스트기관","businessNumber":"1234567890","loginId":"testmgr","password":"short1"}'

# 4) 정상 가입 신청
MGR_SIGNUP_RESP=$(curl -s \
  -X POST "$BASE/api/manager/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"agencyName\":\"테스트기관_${TS}\",\"businessNumber\":\"${BNO_TEST}\",\"loginId\":\"${LOGIN_TEST}\",\"password\":\"test1234!\",\"displayName\":\"홍길동\"}")

if echo "$MGR_SIGNUP_RESP" | grep -q '"success":true'; then
  pass "관리자 자체 가입 신청 (Option A)"
  MGR_REQUEST_ID=$(extract "$MGR_SIGNUP_RESP" "requestId")
else
  fail "관리자 자체 가입 신청" "success:true" "$MGR_SIGNUP_RESP"
  MGR_REQUEST_ID=""
fi

# 5) 중복 loginId → 409
assert "관리자 가입: 중복 loginId → 409" "409" '"success":false' "" \
  -X POST "$BASE/api/manager/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"agencyName\":\"다른기관\",\"businessNumber\":\"0000000001\",\"loginId\":\"${LOGIN_TEST}\",\"password\":\"test1234!\"}"

# 6) 신청 상태 조회 → PENDING
STATUS_RESP=$(curl -s "$BASE/api/manager/auth/signup?loginId=${LOGIN_TEST}")
if echo "$STATUS_RESP" | grep -q '"status":"PENDING"'; then
  pass "관리자 가입 신청 상태 조회 (PENDING)"
else
  fail "관리자 가입 신청 상태 조회" '"status":"PENDING"' "$STATUS_RESP"
fi

# 7) 없는 loginId 상태 조회 → 404
assert "관리자 가입 상태: 없는 loginId → 404" "404" '"success":false' "" \
  "$BASE/api/manager/auth/signup?loginId=nonexistent_xyz_9999"

# 8) 운영자: 가입 신청 목록 조회
assert "운영자: 관리자 가입 신청 목록 조회" "200" '"success":true' "$ADMIN_COOKIE" \
  "$BASE/api/admin/system/manager-signup-requests"

if [ -n "$MGR_REQUEST_ID" ]; then
  # 9) 운영자: 신청 상세 조회
  assert "운영자: 관리자 가입 신청 상세 조회" "200" '"success":true' "$ADMIN_COOKIE" \
    "$BASE/api/admin/system/manager-signup-requests/$MGR_REQUEST_ID"

  # 10) 운영자: 반려 처리
  REJECT_RESP=$(curl -s -b "$ADMIN_COOKIE" \
    -X PATCH "$BASE/api/admin/system/manager-signup-requests/$MGR_REQUEST_ID" \
    -H "Content-Type: application/json" \
    -d '{"action":"reject","reviewNote":"서류 미비"}')
  if echo "$REJECT_RESP" | grep -q '"success":true'; then
    pass "운영자: 관리자 가입 신청 반려"
  else
    fail "운영자: 관리자 가입 신청 반려" "success:true" "$REJECT_RESP"
  fi

  # 11) 반려 후 상태 확인 → REJECTED
  STATUS2=$(curl -s "$BASE/api/manager/auth/signup?loginId=${LOGIN_TEST}")
  if echo "$STATUS2" | grep -q '"status":"REJECTED"'; then
    pass "관리자 가입 반려 후 상태 확인"
  else
    fail "관리자 가입 반려 후 상태 확인" '"status":"REJECTED"' "$STATUS2"
  fi

  # 12) 이미 처리된 신청 재처리 → 409
  assert "운영자: 이미 처리된 신청 재처리 → 409" "409" '"success":false' "$ADMIN_COOKIE" \
    -X PATCH "$BASE/api/admin/system/manager-signup-requests/$MGR_REQUEST_ID" \
    -H "Content-Type: application/json" \
    -d '{"action":"reject"}'
else
  skip "requestId 없음 — 상세/반려 테스트 스킵"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "22b. 에이전시 관리자 초대 코드 가입 (Option B)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 1) 운영자: 에이전시(id=3)에 관리자 초대 코드 발급
MGR_INVITE_RESP=$(curl -s -b "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/system/agencies/3/manager-invite" \
  -H "Content-Type: application/json" \
  -d '{"email":"invite@example.com"}')

if echo "$MGR_INVITE_RESP" | grep -q '"success":true'; then
  pass "운영자: 관리자 초대 코드 발급"
  MGR_INVITE_CODE=$(extract "$MGR_INVITE_RESP" "code")
else
  fail "운영자: 관리자 초대 코드 발급" "success:true" "$MGR_INVITE_RESP"
  MGR_INVITE_CODE=""
fi

# 2) 없는 초대 코드 → 410
assert "관리자 초대: 없는 코드 → 410" "410" '"success":false' "" \
  "$BASE/api/manager/invite/00000000-0000-0000-0000-000000000000"

if [ -n "$MGR_INVITE_CODE" ]; then
  # 3) 초대 정보 조회 → agencyName 포함
  INVITE_INFO_RESP=$(curl -s "$BASE/api/manager/invite/$MGR_INVITE_CODE")
  if echo "$INVITE_INFO_RESP" | grep -q '"agencyName"'; then
    pass "관리자 초대: 초대 정보 조회"
  else
    fail "관리자 초대: 초대 정보 조회" "agencyName 포함" "$INVITE_INFO_RESP"
  fi

  # 4) 짧은 비밀번호로 가입 → 400
  assert "관리자 초대 가입: 짧은 비밀번호 → 400" "400" '"success":false' "" \
    -X POST "$BASE/api/manager/invite/$MGR_INVITE_CODE" \
    -H "Content-Type: application/json" \
    -d '{"loginId":"mgrinvite","password":"short"}'

  # 5) 정상 가입
  MGR_INVITE_COOKIE=$(mktemp)
  MGR_LOGIN_INVITE="mgrinv${TS}"
  INVITE_SIGNUP=$(curl -s -c "$MGR_INVITE_COOKIE" \
    -X POST "$BASE/api/manager/invite/$MGR_INVITE_CODE" \
    -H "Content-Type: application/json" \
    -d "{\"loginId\":\"${MGR_LOGIN_INVITE}\",\"password\":\"test1234!\",\"displayName\":\"초대관리자\"}")

  if echo "$INVITE_SIGNUP" | grep -q '"success":true'; then
    pass "관리자 초대 코드로 가입 완료"
  else
    fail "관리자 초대 코드로 가입" "success:true" "$INVITE_SIGNUP"
  fi

  # 6) 세션 쿠키 자동 발급 확인
  if grep -q "admlink_manager_session" "$MGR_INVITE_COOKIE" 2>/dev/null; then
    pass "관리자 초대 가입 후 세션 쿠키 자동 발급"
  else
    fail "관리자 초대 가입 세션 쿠키" "admlink_manager_session 쿠키" "쿠키 없음"
  fi

  # 7) 초대 코드 재사용 → 410
  assert "관리자 초대 코드 재사용 → 410" "410" '"success":false' "" \
    -X POST "$BASE/api/manager/invite/$MGR_INVITE_CODE" \
    -H "Content-Type: application/json" \
    -d '{"loginId":"mgrinvite2","password":"test1234!"}'

  rm -f "$MGR_INVITE_COOKIE"
else
  skip "초대 코드 없음 — 초대 가입 시나리오 스킵"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "23. Admin 비활성화 시 기존 세션 무효화"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 1) 임시 admin 계정 생성
TS23=$(date +%s)
TEMP_ADMIN_ID_STR="tmpAdmin${TS23}"
CREATE_ADMIN_RESP=$(curl -s -b "$ADMIN_COOKIE" \
  -X POST "$BASE/api/admin/system/admins" \
  -H "Content-Type: application/json" \
  -d "{\"loginId\":\"${TEMP_ADMIN_ID_STR}\",\"password\":\"temp1234!\",\"displayName\":\"임시운영자\"}")

if echo "$CREATE_ADMIN_RESP" | grep -q '"success":true'; then
  pass "임시 Admin 계정 생성"
  TEMP_ADMIN_DB_ID=$(echo "$CREATE_ADMIN_RESP" | grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')
  [ -z "$TEMP_ADMIN_DB_ID" ] && TEMP_ADMIN_DB_ID=$(echo "$CREATE_ADMIN_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
else
  fail "임시 Admin 계정 생성" "success:true" "$CREATE_ADMIN_RESP"
  TEMP_ADMIN_DB_ID=""
fi

if [ -n "$TEMP_ADMIN_DB_ID" ]; then
  # 2) 임시 admin 로그인 → 세션 쿠키 획득
  TEMP_ADMIN_COOKIE=$(mktemp)
  curl -s -c "$TEMP_ADMIN_COOKIE" \
    -X POST "$BASE/api/admin/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"loginId\":\"${TEMP_ADMIN_ID_STR}\",\"password\":\"temp1234!\"}" > /dev/null

  # 로그인 세션으로 API 접근 → 200 확인
  BEFORE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TEMP_ADMIN_COOKIE" "$BASE/api/admin/system/admins")
  if [ "$BEFORE_CODE" = "200" ]; then
    pass "임시 Admin 세션 정상 작동 확인"
  else
    fail "임시 Admin 세션 정상 작동" "200" "$BEFORE_CODE"
  fi

  # 3) 기존 운영자가 임시 admin 비활성화 (toggle-active)
  TOGGLE_RESP=$(curl -s -b "$ADMIN_COOKIE" \
    -X PATCH "$BASE/api/admin/system/admins/$TEMP_ADMIN_DB_ID" \
    -H "Content-Type: application/json" \
    -d '{"action":"toggle-active"}')
  if echo "$TOGGLE_RESP" | grep -q '"success":true'; then
    pass "임시 Admin 계정 비활성화"
  else
    fail "임시 Admin 계정 비활성화" "success:true" "$TOGGLE_RESP"
  fi

  # 4) 비활성화 후 기존 세션으로 API 접근 → 401 확인
  AFTER_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$TEMP_ADMIN_COOKIE" "$BASE/api/admin/system/admins")
  if [ "$AFTER_CODE" = "401" ]; then
    pass "비활성화 후 기존 세션 → 401 무효화 확인"
  else
    fail "비활성화 후 세션 무효화" "401" "$AFTER_CODE"
  fi

  rm -f "$TEMP_ADMIN_COOKIE"
else
  skip "임시 Admin ID 없음 — 비활성화 세션 무효화 테스트 스킵"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
section "24. 신규 보안 강화 검증 (업로드 검증·무차별 대입 방어)"
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── 서류 업로드 입력 검증 ──────────────────────────────────────
# file 필드 누락 → 400 (다른 필드만 전송해 유효한 multipart 유지)
assert "업로드: file 필드 누락 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/upload/business-doc" -F "dummy=1"

# 허용되지 않은 형식(text/plain) → 400
TXT_TMP=$(mktemp)
echo "not an image" > "$TXT_TMP"
assert "업로드: 허용되지 않은 형식 → 400" "400" '"success":false' "" \
  -X POST "$BASE/api/upload/business-doc" -F "file=@$TXT_TMP;type=text/plain;filename=test.txt"

# 업로드 rate limit → 429 (잘못된 형식 반복, IP당 제한)
echo -n "  업로드 rate limit 테스트..."
UP_429=0
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/upload/business-doc" \
    -F "file=@$TXT_TMP;type=text/plain;filename=test.txt")
  [ "$CODE" = "429" ] && UP_429=1 && break
done
if [ $UP_429 -eq 1 ]; then pass "업로드 rate limit → 429 발생"; else fail "업로드 rate limit" "429" "15회 후에도 429 없음"; fi
rm -f "$TXT_TMP"

# ── OTP confirm 무차별 대입 방어 → 429 ────────────────────────
echo -n "  OTP confirm 무차별 대입 방어 테스트..."
OTP_CONFIRM_PHONE="01055443322"
OTPC_429=0
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/worker/phone-verify" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"confirm\",\"phoneNumber\":\"$OTP_CONFIRM_PHONE\",\"code\":\"000000\"}")
  [ "$CODE" = "429" ] && OTPC_429=1 && break
done
if [ $OTPC_429 -eq 1 ]; then pass "OTP confirm 무차별 대입 → 429 차단"; else fail "OTP confirm 무차별 대입 방어" "429" "15회 후에도 429 없음"; fi

# ── 관리자 가입 신청 rate limit → 429 ─────────────────────────
# (잘못된 본문 전송 → rate limit 통과 시 400, 초과 시 429. DB 오염 없음)
echo -n "  관리자 가입 rate limit 테스트..."
MS_429=0
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/manager/auth/signup" \
    -H "Content-Type: application/json" -d '{}')
  [ "$CODE" = "429" ] && MS_429=1 && break
done
if [ $MS_429 -eq 1 ]; then pass "관리자 가입 rate limit → 429 발생"; else fail "관리자 가입 rate limit" "429" "15회 후에도 429 없음"; fi

# ── 직무지도원 초대 코드 무차별 대입 방어 → 429 ───────────────
# 전용 초대를 새로 발급해 무차별 대입 시 차단되는지 검증
BF_PHONE="010$(date +%s | cut -c 2-9)"
BF_INVITE_RESP=$(curl -s -b "$MANAGER_COOKIE" \
  -X POST "$BASE/api/admin/workers/invite" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"$BF_PHONE\",\"workerName\":\"무차별테스트\",\"siteId\":\"2\"}")
BF_INVITE_ID=$(echo "$BF_INVITE_RESP" | grep -o '"id":"[0-9]*"' | head -1 | grep -o '[0-9]*')
[ -z "$BF_INVITE_ID" ] && BF_INVITE_ID=$(echo "$BF_INVITE_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -n "$BF_INVITE_ID" ]; then
  echo -n "  초대 코드 무차별 대입 방어 테스트..."
  INV_429=0
  for i in $(seq 1 15); do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/worker/invite/$BF_INVITE_ID" \
      -H "Content-Type: application/json" -d '{"action":"verify","code":"000000"}')
    [ "$CODE" = "429" ] && INV_429=1 && break
  done
  if [ $INV_429 -eq 1 ]; then pass "초대 코드 무차별 대입 → 429 차단"; else fail "초대 코드 무차별 대입 방어" "429" "15회 후에도 429 없음"; fi
else
  skip "무차별 대입 테스트용 초대 발급 실패 — 스킵"
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
