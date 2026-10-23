#!/usr/bin/env bash
# smoke-test.sh — small end-to-end check against the LIVE dev stack.
#
#   ./start-dev.sh && ./smoke-test.sh
#
# Unlike the unit/integration suites (mocked frontend, Testcontainers
# backend), this drives the real running servers over HTTP, through the
# frontend origin so the Vite /api proxy is part of the path — the same way a
# browser reaches the app:
#
#   static serving → register → workspace (+ default seed) → client + offer
#   → pipeline board → move offer between columns → auth/tenant negatives →
#   workspace cleanup
#
# Exits non-zero if any step fails. Overrides: BACKEND_URL, FRONTEND_URL.

set -uo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

PASS=0
FAIL=0
TOKEN=""
WORKSPACE_ID=""

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

check() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 — expected [$2], got [$3]"; fi
}

check_contains() { # <label> <haystack> <needle>
  case "$2" in
    *"$3"*) pass "$1" ;;
    *) fail "$1 — response did not contain [$3]" ;;
  esac
}

check_any_of() { # <label> <space-separated accepted codes> <actual>
  local ok=0 code
  for code in $2; do [ "$code" = "$3" ] && ok=1; done
  if [ "$ok" = 1 ]; then pass "$1"; else fail "$1 — expected one of [$2], got [$3]"; fi
}

http() { # <method> <url> [json-body] [token] [workspace] → HTTP_CODE, HTTP_BODY
  local method=$1 url=$2 body=${3:-} token=${4:-} ws=${5:-}
  local args=(-sS --max-time 20 -X "$method" -o "$BODY_FILE" -w '%{http_code}')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$ws" ] && args+=(-H "X-Workspace: $ws")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data "$body")
  HTTP_CODE=$(curl "${args[@]}" "$url" 2>/dev/null) || HTTP_CODE=000
  HTTP_BODY=$(cat "$BODY_FILE" 2>/dev/null || true)
}

json_str() { # <key> <json> — first "key":"value"
  printf '%s' "$2" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | sed "s/^\"$1\":\"//; s/\"$//"
}

json_num() { # <key> <json> — first "key":123
  printf '%s' "$2" | grep -o "\"$1\":[0-9]*" | head -1 | sed "s/^\"$1\"://"
}

summary() {
  # Best-effort cleanup if the workspace still exists.
  if [ -n "$WORKSPACE_ID" ] && [ -n "$TOKEN" ]; then
    http DELETE "$FRONTEND_URL/api/workspaces/$WORKSPACE_ID" "" "$TOKEN" "$WORKSPACE_ID"
    if [ "$HTTP_CODE" = 204 ] || [ "$HTTP_CODE" = 200 ]; then
      pass "cleanup: workspace deleted"
    else
      fail "cleanup: workspace delete returned $HTTP_CODE"
    fi
  fi
  printf '\n  %d passed, %d failed\n' "$PASS" "$FAIL"
  if [ "$FAIL" -eq 0 ]; then
    echo "SMOKE TEST PASSED"
    exit 0
  fi
  echo "SMOKE TEST FAILED"
  exit 1
}

abort() {
  printf '\n  abort: %s\n' "$1"
  summary
}

echo "── end-to-end smoke test ──"
echo "   frontend $FRONTEND_URL  (api via Vite proxy) · backend $BACKEND_URL"

echo "[1] servers are up"
http GET "$FRONTEND_URL/"
check "frontend serves the app (200)" 200 "$HTTP_CODE"
check_contains "frontend serves the Roster shell" "$HTTP_BODY" "<title>Roster"
http GET "$BACKEND_URL/actuator/health"
check "backend health (200)" 200 "$HTTP_CODE"
check_contains "backend reports UP" "$HTTP_BODY" '"status":"UP"'

echo "[2] the frontend origin proxies /api to the backend"
http GET "$FRONTEND_URL/api/auth/me"
check "unauthenticated /api call through Vite → 401" 401 "$HTTP_CODE"

echo "[3] register + workspace through the frontend origin"
TS=$(date +%s)
http POST "$FRONTEND_URL/api/auth/register" \
  "{\"email\":\"smoke-$TS@example.test\",\"password\":\"password123\",\"displayName\":\"Smoke Tester\"}"
check "register (201)" 201 "$HTTP_CODE"
TOKEN=$(json_str token "$HTTP_BODY")
[ -n "$TOKEN" ] || abort "register returned no token"

http POST "$FRONTEND_URL/api/workspaces" "{\"name\":\"Smoke Co $TS\"}" "$TOKEN"
check "create workspace (201)" 201 "$HTTP_CODE"
WORKSPACE_ID=$(json_num id "$HTTP_BODY")
[ -n "$WORKSPACE_ID" ] || abort "workspace creation returned no id"

echo "[4] default seed: pipeline stages"
http GET "$FRONTEND_URL/api/pipeline/stages" "" "$TOKEN" "$WORKSPACE_ID"
check "stages readable via proxy (200)" 200 "$HTTP_CODE"
STAGE_NAMES=$(printf '%s' "$HTTP_BODY" | grep -o '"name":"[^"]*"' \
  | sed 's/"name":"//; s/"$//' | tr '\n' ' ' | sed 's/ $//')
check "four default stages, in order" "Sourcing Interviewing Onboarding Live" "$STAGE_NAMES"
INTERVIEW_ID=$(printf '%s' "$HTTP_BODY" | grep -o '"id":[0-9]*' | sed -n '2p' | cut -d: -f2)
[ -n "$INTERVIEW_ID" ] || abort "could not read the Interviewing stage id"

echo "[5] client + offer"
http POST "$FRONTEND_URL/api/clients" "{\"name\":\"Smoke Client $TS\"}" "$TOKEN" "$WORKSPACE_ID"
check "create client (201)" 201 "$HTTP_CODE"
CLIENT_ID=$(json_num id "$HTTP_BODY")
http POST "$FRONTEND_URL/api/offers" \
  "{\"clientId\":$CLIENT_ID,\"title\":\"Smoke role\",\"seats\":2}" "$TOKEN" "$WORKSPACE_ID"
check "create offer (201)" 201 "$HTTP_CODE"
OFFER_ID=$(json_num id "$HTTP_BODY")
check "new offer lands in the first column" "Sourcing" "$(json_str stageName "$HTTP_BODY")"

echo "[6] pipeline board groups offers under their columns"
http GET "$FRONTEND_URL/api/pipeline/board" "" "$TOKEN" "$WORKSPACE_ID"
check "board (200)" 200 "$HTTP_CODE"
BOARD_COLS=$(printf '%s' "$HTTP_BODY" | grep -o '"stage":{"id":[0-9]*,"name":"[^"]*"' \
  | sed 's/.*"name":"//; s/"$//' | tr '\n' ' ' | sed 's/ $//')
check "columns in stage order" "Sourcing Interviewing Onboarding Live" "$BOARD_COLS"
check_contains "the offer shows up on the board" "$HTTP_BODY" '"title":"Smoke role"'

echo "[7] move the offer to another column"
http POST "$FRONTEND_URL/api/offers/$OFFER_ID/stage" \
  "{\"stageId\":$INTERVIEW_ID}" "$TOKEN" "$WORKSPACE_ID"
check "stage move (200)" 200 "$HTTP_CODE"
check "offer reports its new stage" "Interviewing" "$(json_str stageName "$HTTP_BODY")"
http GET "$FRONTEND_URL/api/pipeline/board" "" "$TOKEN" "$WORKSPACE_ID"
# The card must now live inside the Interviewing column's JSON chunk (board
# columns are separate objects split on {"stage":).
if printf '%s' "$HTTP_BODY" | awk -v t='"title":"Smoke role"' \
    'BEGIN { RS = "\\{\"stage\":" }
     NR > 1 && index($0, t) > 0 { found = 1; ok = (index($0, ",\"name\":\"Interviewing\"") > 0) }
     END { exit !(found && ok) }'; then
  pass "board shows the card in the Interviewing column"
else
  fail "board does not show the card in the Interviewing column"
fi

echo "[8] auth and tenant negatives"
http GET "$BACKEND_URL/api/pipeline/stages"
check "no token → 401" 401 "$HTTP_CODE"
http GET "$BACKEND_URL/api/pipeline/stages" "" "$TOKEN" "999999"
check "foreign workspace → 403" 403 "$HTTP_CODE"

echo "[9] cleanup (also runs when earlier steps failed)"
summary
