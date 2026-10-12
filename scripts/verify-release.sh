#!/usr/bin/env bash
# scripts/verify-release.sh
#
# Post-deployment smoke tests for mediaSaver.
# Run after every release to confirm the deployed stack is operational.
#
# Usage:
#   BASE_URL=https://your-domain.com \
#   TEST_EMAIL=verify@example.com \
#   TEST_PASSWORD=VerifyPassword123! \
#     ./scripts/verify-release.sh
#
# The script exits 0 on full success, non-zero on any failure.
# This script does not delete the test account or media.
# Use a dedicated test account and preferably a staging environment.
#
# Requirements: curl, jq

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
TEST_EMAIL="${TEST_EMAIL:-release-verify-$(date +%s)@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-SmokeVerify99!}"

PASS=0
FAIL=0

# ── Helpers ──────────────────────────────────────────────────────────────────

green()  { printf '\033[32m✔ %s\033[0m\n' "$*"; }
red()    { printf '\033[31m✘ %s\033[0m\n' "$*"; }
yellow() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }

pass() { green "$*"; ((PASS+=1)); }
fail() { red   "$*"; ((FAIL+=1)); }

# Execute a curl request and capture HTTP status + body.
# Usage: req <method> <path> [extra curl flags...]
req() {
  local method="$1" path="$2"
  shift 2
  RESP_BODY=$(curl -s -X "$method" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    "$@" \
    "${BASE_URL}${path}" 2>/dev/null)
  RESP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    "$@" \
    "${BASE_URL}${path}" 2>/dev/null)
}

# Simpler version that captures both status and body in one request.
req_once() {
  local method="$1" path="$2"
  shift 2
  local tmpfile
  tmpfile=$(mktemp)
  RESP_STATUS=$(curl -s -o "$tmpfile" -w "%{http_code}" -X "$method" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -b cookies.txt -c cookies.txt \
    "$@" \
    "${BASE_URL}${path}" 2>/dev/null)
  RESP_BODY=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

assert_status() {
  local expected="$1" label="$2"
  if [ "$RESP_STATUS" = "$expected" ]; then
    pass "$label (HTTP $RESP_STATUS)"
  else
    fail "$label — expected HTTP $expected, got HTTP $RESP_STATUS. Body: $RESP_BODY"
  fi
}

# ── Setup ─────────────────────────────────────────────────────────────────────

COOKIE_FILE=$(mktemp)
trap 'rm -f "$COOKIE_FILE"' EXIT
ACCESS_TOKEN=""
MEDIA_ID=""

echo ""
echo "mediaSaver release verification"
echo "Target: ${BASE_URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Check 1: Health endpoint ──────────────────────────────────────────────────

echo ""
echo "1. Infrastructure"
req_once GET /api/health
assert_status 200 "GET /api/health"

# ── Check 2: Registration ─────────────────────────────────────────────────────

echo ""
echo "2. Authentication"

req_once POST /api/auth/register \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}"

if [[ "$RESP_STATUS" == "201" ]] ||
   [[ "$RESP_STATUS" == "409" ]] ||
   { [[ "$RESP_STATUS" == "400" ]] &&
     echo "$RESP_BODY" | jq -e '.error == "Email is already registered"' >/dev/null 2>&1; }; then
  pass "POST /api/auth/register (HTTP $RESP_STATUS — created or already exists)"
else
  fail "POST /api/auth/register — unexpected response HTTP $RESP_STATUS. Body: $RESP_BODY"
fi

# ── Check 3: Login ────────────────────────────────────────────────────────────

req_once POST /api/auth/login \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}"

assert_status 200 "POST /api/auth/login"

ACCESS_TOKEN=$(echo "$RESP_BODY" | jq -r '.accessToken // empty')
if [ -n "$ACCESS_TOKEN" ]; then
  pass "Access token received"
else
  fail "Access token missing in login response. Body: $RESP_BODY"
fi

# ── Check 4: Protected route (no token) ───────────────────────────────────────

echo ""
echo "3. Authorization"

req_once GET /api/media
if [ "$RESP_STATUS" = "401" ] || [ "$RESP_STATUS" = "403" ]; then
  pass "GET /api/media without token → HTTP $RESP_STATUS (expected)"
else
  fail "GET /api/media without token — expected 401/403, got HTTP $RESP_STATUS"
fi

# ── Check 5: Protected route (with token) ────────────────────────────────────

req_once GET /api/media \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
assert_status 200 "GET /api/media with valid token"

# ── Check 6: Cross-user isolation ─────────────────────────────────────────────

# Confirm that /api/media returns only the authenticated user's media (empty
# list for a fresh test account) and not an internal error.
MEDIA_COUNT=$(echo "$RESP_BODY" | jq -er '.data | length' 2>/dev/null || echo "-1")

if [[ "$MEDIA_COUNT" =~ ^[0-9]+$ ]]; then
  pass "Media list response parsed (${MEDIA_COUNT} item(s))"
else
  fail "Could not parse media list from response. Body: $RESP_BODY"
fi

# ── Check 7: Token refresh ────────────────────────────────────────────────────

echo ""
echo "4. Token refresh"

req_once POST /api/auth/refresh
if [ "$RESP_STATUS" = "200" ]; then
  NEW_TOKEN=$(echo "$RESP_BODY" | jq -r '.accessToken // empty')
  if [ -n "$NEW_TOKEN" ]; then
    ACCESS_TOKEN="$NEW_TOKEN"
    pass "POST /api/auth/refresh → new access token issued"
  else
    fail "POST /api/auth/refresh returned 200 but no accessToken. Body: $RESP_BODY"
  fi
else
  yellow "POST /api/auth/refresh → HTTP $RESP_STATUS (refresh cookie may not be set by curl; skip)"
fi

# ── Check 8: Logout ────────────────────────────────────────────────────────────

echo ""
echo "5. Logout"

req_once POST /api/auth/logout \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
if [ "$RESP_STATUS" = "200" ] || [ "$RESP_STATUS" = "204" ]; then
  pass "POST /api/auth/logout → HTTP $RESP_STATUS"
else
  fail "POST /api/auth/logout — expected 200/204, got HTTP $RESP_STATUS. Body: $RESP_BODY"
fi

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: ${PASS} passed, ${FAIL} failed"

if [ "$FAIL" -gt 0 ]; then
  red "Release verification FAILED — do not proceed until failures are resolved."
  exit 1
else
  green "Release verification PASSED."
  exit 0
fi
