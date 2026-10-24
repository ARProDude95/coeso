#!/usr/bin/env bash
# smoke-community.sh — community-features end-to-end check against the LIVE stack.
#
#   ./start-dev.sh && ./smoke-community.sh
#
# Drives the real running servers over HTTP the way a browser does — through
# the frontend origin so the Vite /api proxy is part of the path (falls back
# to the backend directly when the frontend is not running):
#
#   intros profile (owner + invitee) → invite lifecycle (create, list,
#   accept, single-use token) → intro request (suggested by tag overlap,
#   pending both ways, duplicate refused, non-recipient refused) → accept as
#   the target → contact reveal for the pair only → decline reveals nothing →
#   deterministic pod generation (generate twice, publish the preview) →
#   private pod thread (post, read as member, refused for an outsider, blank
#   body refused) → workspace cleanup
#
# Repeatable by construction: every run uses a fresh timestamped email/slug,
# so back-to-back runs never collide; cleanup soft-deletes the workspace
# (the hourly WorkspacePurgeJob removes its children afterwards).
# Exits non-zero if any step fails. Overrides: BACKEND_URL, FRONTEND_URL.

set -uo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

PASS=0
FAIL=0
TOKEN=""
MEMBER_TOKEN=""
WORKSPACE_ID=""
MEMBER_ID=""
POD_ID=""

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
    http DELETE "$BASE/api/workspaces/$WORKSPACE_ID" "" "$TOKEN" "$WORKSPACE_ID"
    if [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "200" ]; then
      pass "cleanup: workspace deleted (purge job removes its children)"
    else
      fail "cleanup: workspace delete returned $HTTP_CODE"
    fi
  fi
  printf '\n  %d passed, %d failed\n' "$PASS" "$FAIL"
  if [ "$FAIL" -eq 0 ]; then
    echo "COMMUNITY SMOKE PASSED"
    exit 0
  fi
  echo "COMMUNITY SMOKE FAILED"
  exit 1
}

abort() {
  printf '\n  abort: %s\n' "$1"
  summary
}

echo "── community-features smoke ──"
echo "   backend $BACKEND_URL · frontend $FRONTEND_URL"

echo "[1] servers are up"
http GET "$BACKEND_URL/actuator/health"
check "backend health (200)" 200 "$HTTP_CODE"
check_contains "backend reports UP" "$HTTP_BODY" '"status":"UP"'

BASE="$FRONTEND_URL"
http GET "$FRONTEND_URL/"
if [ "$HTTP_CODE" != "200" ]; then
  BASE="$BACKEND_URL"
  echo "   note: frontend not reachable at $FRONTEND_URL — driving $BACKEND_URL directly"
else
  check_contains "frontend serves the Roster shell" "$HTTP_BODY" "<title>Roster"
  http GET "$FRONTEND_URL/api/auth/me"
  check "unauthenticated /api call through Vite → 401" 401 "$HTTP_CODE"
fi

TS=$(date +%s)
echo "[2] register owner + fresh workspace ($TS)"
http POST "$BASE/api/auth/register" \
  "{\"email\":\"comm-owner-$TS@example.test\",\"password\":\"password123\",\"displayName\":\"Community Owner\"}"
check "owner register (201)" 201 "$HTTP_CODE"
TOKEN=$(json_str token "$HTTP_BODY")
[ -n "$TOKEN" ] || abort "register returned no token"

http POST "$BASE/api/workspaces" "{\"name\":\"Community Smoke $TS\"}" "$TOKEN"
check "create workspace (201)" 201 "$HTTP_CODE"
WORKSPACE_ID=$(json_num id "$HTTP_BODY")
[ -n "$WORKSPACE_ID" ] || abort "workspace creation returned no id"

echo "[3] intros profile (industry + revenue stage + tags)"
http PUT "$BASE/api/intros/profile" \
  "{\"industry\":\"Fintech\",\"revenueStage\":\"Seed\",\"offeringTags\":[\"fundraising\"],\"lookingForTags\":[\"hiring\"]}" \
  "$TOKEN" "$WORKSPACE_ID"
check "owner profile save (200)" 200 "$HTTP_CODE"
http GET "$BASE/api/intros/profile" "" "$TOKEN" "$WORKSPACE_ID"
check "profile readable (200)" 200 "$HTTP_CODE"
check "industry persisted" "Fintech" "$(json_str industry "$HTTP_BODY")"
check "revenue stage persisted" "Seed" "$(json_str revenueStage "$HTTP_BODY")"

echo "[4] invite lifecycle"
INVITE_EMAIL="comm-member-$TS@example.test"
http POST "$BASE/api/invites" \
  "{\"email\":\"$INVITE_EMAIL\",\"role\":\"MANAGER\"}" "$TOKEN" "$WORKSPACE_ID"
check "create invite (201)" 201 "$HTTP_CODE"
INVITE_TOKEN=$(json_str token "$HTTP_BODY")
[ -n "$INVITE_TOKEN" ] || abort "invite creation returned no token"
check_contains "link carries the token" "$HTTP_BODY" "$INVITE_TOKEN"
http GET "$BASE/api/invites" "" "$TOKEN" "$WORKSPACE_ID"
check "invite listed (200)" 200 "$HTTP_CODE"
check_contains "listing shows the invited email" "$HTTP_BODY" "$INVITE_EMAIL"

http POST "$BASE/api/auth/register" \
  "{\"email\":\"$INVITE_EMAIL\",\"password\":\"password123\",\"displayName\":\"Community Member\"}"
check "invitee register (201)" 201 "$HTTP_CODE"
MEMBER_TOKEN=$(json_str token "$HTTP_BODY")
[ -n "$MEMBER_TOKEN" ] || abort "invitee register returned no token"

http POST "$BASE/api/invites/accept?token=$INVITE_TOKEN" "" "$MEMBER_TOKEN"
check "accept invite (200)" 200 "$HTTP_CODE"
check "joined with the invited role" "MANAGER" "$(json_str role "$HTTP_BODY")"
check "joined THIS workspace" "$WORKSPACE_ID" "$(json_num workspaceId "$HTTP_BODY")"

http POST "$BASE/api/invites/accept?token=$INVITE_TOKEN" "" "$MEMBER_TOKEN"
check "token is single-use (re-accept → 409)" 409 "$HTTP_CODE"

echo "[5] invitee profile (second pod member)"
http GET "$BASE/api/auth/me" "" "$MEMBER_TOKEN"
check "invitee identity readable (200)" 200 "$HTTP_CODE"
MEMBER_ID=$(json_num id "$HTTP_BODY")
check "invitee login email is the invited address" "$INVITE_EMAIL" "$(json_str email "$HTTP_BODY")"
[ -n "$MEMBER_ID" ] || abort "could not read the invitee user id"

http PUT "$BASE/api/intros/profile" \
  "{\"industry\":\"SaaS\",\"revenueStage\":\"Series A\",\"offeringTags\":[\"hiring\"],\"lookingForTags\":[\"fundraising\"]}" \
  "$MEMBER_TOKEN" "$WORKSPACE_ID"
check "invitee profile save (200)" 200 "$HTTP_CODE"

echo "[6] intros: request → accept → contact reveal"
# The two profiles are complementary (owner offers fundraising/looks for
# hiring; invitee offers hiring/looks for fundraising), so the invitee is
# already a suggestion for the owner before any request exists.
http GET "$BASE/api/intros/suggestions" "" "$TOKEN" "$WORKSPACE_ID"
check "owner gets suggestions (200)" 200 "$HTTP_CODE"
check_contains "tag overlap suggests the invitee" "$HTTP_BODY" '"displayName":"Community Member"'
check_contains "every suggestion carries a reason" "$HTTP_BODY" '"reason":"'

http POST "$BASE/api/intros/requests" \
  "{\"targetUserId\":$MEMBER_ID,\"reason\":\"fundraising intro\"}" "$TOKEN" "$WORKSPACE_ID"
check "request an intro (201)" 201 "$HTTP_CODE"
REQUEST_ID=$(json_num id "$HTTP_BODY")
[ -n "$REQUEST_ID" ] || abort "intro request returned no id"
check "new request starts pending" "pending" "$(json_str status "$HTTP_BODY")"
check_contains "no contact before acceptance" "$HTTP_BODY" '"contactEmail":null'

http GET "$BASE/api/intros/requests/outgoing" "" "$TOKEN" "$WORKSPACE_ID"
check "outgoing lists the request (200)" 200 "$HTTP_CODE"
check_contains "outgoing names the target" "$HTTP_BODY" '"toName":"Community Member"'
check_contains "outgoing keeps the contact hidden" "$HTTP_BODY" '"contactEmail":null'

http GET "$BASE/api/intros/requests/incoming" "" "$MEMBER_TOKEN" "$WORKSPACE_ID"
check "incoming reaches the target (200)" 200 "$HTTP_CODE"
check_contains "incoming names the requester" "$HTTP_BODY" '"fromName":"Community Owner"'
OWNER_ID=$(json_num fromUserId "$HTTP_BODY")

# Only the recipient may answer, and a duplicate request is refused while the
# first one is still pending.
http POST "$BASE/api/intros/requests/$REQUEST_ID/accept" "" "$TOKEN" "$WORKSPACE_ID"
check "requester cannot accept their own request (403)" 403 "$HTTP_CODE"
http POST "$BASE/api/intros/requests" \
  "{\"targetUserId\":$MEMBER_ID}" "$TOKEN" "$WORKSPACE_ID"
check "duplicate pending request refused (409)" 409 "$HTTP_CODE"

# Accept as the target: the pair can now see the contact email.
http POST "$BASE/api/intros/requests/$REQUEST_ID/accept" "" "$MEMBER_TOKEN" "$WORKSPACE_ID"
check "target accepts (200)" 200 "$HTTP_CODE"
check "status flips to accepted" "accepted" "$(json_str status "$HTTP_BODY")"
check "accepting reveals the invitee's login email" "$INVITE_EMAIL" \
  "$(json_str contactEmail "$HTTP_BODY")"

http GET "$BASE/api/intros/requests/outgoing" "" "$TOKEN" "$WORKSPACE_ID"
check "requester keeps seeing the revealed contact (200)" 200 "$HTTP_CODE"
check_contains "revealed contact is the invitee's email" "$HTTP_BODY" \
  "\"contactEmail\":\"$INVITE_EMAIL\""
http POST "$BASE/api/intros/requests/$REQUEST_ID/accept" "" "$MEMBER_TOKEN" "$WORKSPACE_ID"
check "a settled request cannot be accepted twice (409)" 409 "$HTTP_CODE"

# The other direction declines: contact stays hidden.
http POST "$BASE/api/intros/requests" \
  "{\"targetUserId\":$OWNER_ID}" "$MEMBER_TOKEN" "$WORKSPACE_ID"
check "reverse request (201)" 201 "$HTTP_CODE"
REVERSE_ID=$(json_num id "$HTTP_BODY")
http POST "$BASE/api/intros/requests/$REVERSE_ID/decline" "" "$TOKEN" "$WORKSPACE_ID"
check "target declines (200)" 200 "$HTTP_CODE"
check "status flips to declined" "declined" "$(json_str status "$HTTP_BODY")"
check_contains "declining reveals no contact" "$HTTP_BODY" '"contactEmail":null'

echo "[7] deterministic pod generation + publish"
http POST "$BASE/api/pods/generate" "" "$TOKEN" "$WORKSPACE_ID"
check "generate preview (200)" 200 "$HTTP_CODE"
GEN1="$HTTP_BODY"
DRAFTS=$(printf '%s' "$GEN1" | grep -o '"userIds":' | wc -l | tr -d ' ')
check "one draft for two members" "1" "$DRAFTS"
IDS=$(printf '%s' "$GEN1" | grep -o '"userIds":\[[0-9,]*\]' | head -1)
MEMBER_COUNT=$(( $(printf '%s' "$IDS" | tr -cd ',' | wc -c) + 1 ))
check "preview partitions both members" "2" "$MEMBER_COUNT"

http POST "$BASE/api/pods/generate" "" "$TOKEN" "$WORKSPACE_ID"
GEN2="$HTTP_BODY"
if [ "$GEN1" = "$GEN2" ]; then
  pass "preview is deterministic across calls"
else
  fail "preview differs between two generates"
fi

http POST "$BASE/api/pods/publish" "{\"namePrefix\":\"Community\"}" "$TOKEN" "$WORKSPACE_ID"
check "publish (200)" 200 "$HTTP_CODE"
PUB="$HTTP_BODY"
check_contains "published pod carries the prefix" "$PUB" '"name":"Community 1"'
PUB_MEMBERS=$(printf '%s' "$PUB" | grep -o '"userId":[0-9]*' | wc -l | tr -d ' ')
check "publish writes both members" "2" "$PUB_MEMBERS"
POD_ID=$(json_num id "$PUB")
[ -n "$POD_ID" ] || abort "publish returned no pod id"

echo "[8] private pod thread"
MSG="community-smoke-$TS"
http POST "$BASE/api/pods/$POD_ID/messages" "{\"body\":\"$MSG\"}" "$TOKEN" "$WORKSPACE_ID"
check "owner posts (200)" 200 "$HTTP_CODE"
check_contains "post renders with the author's name" "$HTTP_BODY" '"displayName":"Community Owner"'

http GET "$BASE/api/pods/$POD_ID/messages" "" "$TOKEN" "$WORKSPACE_ID"
check "owner reads the thread (200)" 200 "$HTTP_CODE"
check_contains "message is in the thread" "$HTTP_BODY" "$MSG"

http GET "$BASE/api/pods/$POD_ID/messages" "" "$MEMBER_TOKEN" "$WORKSPACE_ID"
check "invitee (pod member) reads the thread (200)" 200 "$HTTP_CODE"
check_contains "invitee sees the message too" "$HTTP_BODY" "$MSG"

http POST "$BASE/api/pods/$POD_ID/messages" "{\"body\":\"   \"}" "$TOKEN" "$WORKSPACE_ID"
check "blank message refused (400)" 400 "$HTTP_CODE"

http POST "$BASE/api/auth/register" \
  "{\"email\":\"comm-outsider-$TS@example.test\",\"password\":\"password123\",\"displayName\":\"Outsider\"}"
check "outsider register (201)" 201 "$HTTP_CODE"
OUTSIDER_TOKEN=$(json_str token "$HTTP_BODY")
http GET "$BASE/api/pods/$POD_ID/messages" "" "$OUTSIDER_TOKEN" "$WORKSPACE_ID"
check "non-member reads the private thread (403)" 403 "$HTTP_CODE"

echo "[9] cleanup (also runs when earlier steps failed)"
summary
