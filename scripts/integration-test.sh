#!/usr/bin/env bash
# Integration Test Script for Beta Stage Post-Deployment Verification
#
# Runs HTTP smoke tests against the deployed CloudFront distribution and
# API Gateway endpoint to verify the website and contact form API are
# functioning correctly before promoting to Prod.
#
# Required environment variables:
#   CLOUDFRONT_URL   - CloudFront distribution URL (e.g., https://beta.example.com)
#   API_GATEWAY_URL  - API Gateway endpoint URL (e.g., https://api.beta.example.com)
#   REGION           - AWS region (e.g., us-east-2)
#   STAGE            - Deployment stage (e.g., beta)
#
# Usage:
#   CLOUDFRONT_URL=https://beta.example.com \
#   API_GATEWAY_URL=https://api.beta.example.com \
#   REGION=us-east-2 \
#   STAGE=beta \
#   ./scripts/integration-test.sh

set -euo pipefail

# ---------- Configuration ----------
CURL_TIMEOUT="${CURL_TIMEOUT:-30}"
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# ---------- Validate required environment variables ----------
MISSING_VARS=()
for var in CLOUDFRONT_URL API_GATEWAY_URL REGION STAGE; do
  if [[ -z "${!var:-}" ]]; then
    MISSING_VARS+=("$var")
  fi
done

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
  echo "ERROR: Missing required environment variables: ${MISSING_VARS[*]}"
  echo ""
  echo "Required variables:"
  echo "  CLOUDFRONT_URL   - CloudFront distribution URL"
  echo "  API_GATEWAY_URL  - API Gateway endpoint URL"
  echo "  REGION           - AWS region"
  echo "  STAGE            - Deployment stage"
  exit 1
fi

echo "============================================================"
echo "  Integration Tests — ${STAGE} (${REGION})"
echo "============================================================"
echo "  CloudFront URL:   ${CLOUDFRONT_URL}"
echo "  API Gateway URL:  ${API_GATEWAY_URL}"
echo "  Curl Timeout:     ${CURL_TIMEOUT}s"
echo ""

# ---------- Helpers ----------
pass() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  echo "  ✅ PASS: $1"
}

fail() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  echo "  ❌ FAIL: $1"
  echo "         $2"
}

# ---------- Test 1: CloudFront health check ----------
echo ""
echo "--- Test 1: CloudFront Health Check ---"

CF_HTTP_CODE=$(curl -s -o /tmp/cf_response.html -w "%{http_code}" \
  --max-time "${CURL_TIMEOUT}" \
  "${CLOUDFRONT_URL}" 2>/dev/null || echo "000")

CF_BODY=$(cat /tmp/cf_response.html 2>/dev/null || echo "")

if [[ "${CF_HTTP_CODE}" == "200" ]]; then
  pass "CloudFront returned HTTP 200"
else
  fail "CloudFront returned HTTP ${CF_HTTP_CODE}" "Expected HTTP 200"
fi

if echo "${CF_BODY}" | grep -q '<div id="root">'; then
  pass "CloudFront response contains <div id=\"root\">"
else
  fail "CloudFront response missing <div id=\"root\">" "Response body does not contain expected React root element"
fi

# ---------- Test 2: API Gateway success (valid payload) ----------
echo ""
echo "--- Test 2: API Gateway POST /contact (valid payload) ---"

API_HTTP_CODE=$(curl -s -o /tmp/api_response.json -w "%{http_code}" \
  --max-time "${CURL_TIMEOUT}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"Integration Test","email":"test@example.com","subject":"Smoke Test","message":"Automated integration test from pipeline"}' \
  "${API_GATEWAY_URL}/contact" 2>/dev/null || echo "000")

if [[ "${API_HTTP_CODE}" == "200" ]]; then
  pass "API Gateway POST /contact returned HTTP 200 for valid payload"
else
  fail "API Gateway POST /contact returned HTTP ${API_HTTP_CODE}" "Expected HTTP 200 for valid payload"
fi

# ---------- Test 3: API Gateway error handling (empty payload) ----------
echo ""
echo "--- Test 3: API Gateway POST /contact (empty payload) ---"

API_ERR_HTTP_CODE=$(curl -s -o /tmp/api_error_response.json -w "%{http_code}" \
  --max-time "${CURL_TIMEOUT}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "${API_GATEWAY_URL}/contact" 2>/dev/null || echo "000")

if [[ "${API_ERR_HTTP_CODE}" == "400" ]]; then
  pass "API Gateway POST /contact returned HTTP 400 for empty payload"
else
  fail "API Gateway POST /contact returned HTTP ${API_ERR_HTTP_CODE}" "Expected HTTP 400 for empty payload"
fi

# ---------- Summary ----------
echo ""
echo "============================================================"
echo "  Results: ${TESTS_PASSED}/${TESTS_TOTAL} passed, ${TESTS_FAILED}/${TESTS_TOTAL} failed"
echo "============================================================"

if [[ ${TESTS_FAILED} -gt 0 ]]; then
  echo ""
  echo "Integration tests FAILED. Pipeline will not promote to Prod."
  exit 1
fi

echo ""
echo "All integration tests PASSED."
exit 0
