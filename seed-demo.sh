#!/usr/bin/env bash
# seed-demo.sh — populate a demo workspace so the pipeline board (and roster)
# are worth looking at:
#
#   ./start-dev.sh && ./seed-demo.sh
#
# Creates (or reuses) a "Demo Agency" workspace owned by a demo account and —
# only when its board is still empty — seeds:
#
#   5 clients · 10 reps with full Phase 6 profiles (the free plan's rep cap) ·
#   8 offers distributed 2 per board column · 5 active placements (one offer
#   filled, the rest partial), requirements chips on the marquee offers.
#
# Idempotent: a populated board is left untouched (offers cannot be deleted,
# only closed). To reseed from scratch, run with a fresh
# DEMO_WORKSPACE_NAME — a soft-deleted workspace keeps its slug, so the old
# name can never be created again. Prints credentials and URL to review with.
#
# Overrides: FRONTEND_URL, DEMO_EMAIL, DEMO_PASSWORD.

set -uo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
DEMO_EMAIL="${DEMO_EMAIL:-demo@example.test}"
DEMO_PASSWORD="${DEMO_PASSWORD:-password123}"
# A deleted workspace keeps its slug (slug uniqueness is global), so a
# from-scratch reseed needs a fresh name: DEMO_WORKSPACE_NAME='Demo Agency 2'.
WORKSPACE_NAME="${DEMO_WORKSPACE_NAME:-Demo Agency}"

PASS=0
FAIL=0
TOKEN=""
WORKSPACE_ID=""

BODY_FILE="$(mktemp)"
BODY_DATA="$(mktemp)"
trap 'rm -f "$BODY_FILE" "$BODY_DATA"' EXIT

pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

check() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 — expected [$2], got [$3]"; fi
}

http() { # <method> <url> [json-body] [token] [workspace] → HTTP_CODE, HTTP_BODY
  local method=$1 url=$2 body=${3:-} token=${4:-} ws=${5:-}
  local args=(-sS --max-time 20 -X "$method" -o "$BODY_FILE" -w '%{http_code}')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$ws" ] && args+=(-H "X-Workspace: $ws")
  if [ -n "$body" ]; then
    # Windows/Git Bash curl mangles non-ASCII ARGV (the backend then answers
    # 400 "Malformed request body"): send raw UTF-8 bytes from a file.
    printf '%s' "$body" > "$BODY_DATA"
    args+=(-H 'Content-Type: application/json' --data-binary "@$BODY_DATA")
  fi
  HTTP_CODE=$(curl "${args[@]}" "$url" 2>/dev/null) || HTTP_CODE=000
  HTTP_BODY=$(cat "$BODY_FILE" 2>/dev/null || true)
}

json_str() { printf '%s' "$2" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | sed "s/^\"$1\":\"//; s/\"$//"; }
json_num() { printf '%s' "$2" | grep -o "\"$1\":[0-9]*" | head -1 | sed "s/^\"$1\"://"; }

# id_of <json-array> <key> <value> — id of the object whose key matches value.
# Objects are split on '}' (flat lookup arrays — no nested braces in them).
id_of() {
  printf '%s' "$1" | tr '}' '\n' | grep "\"$2\":\"$3\"" \
    | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2
}

credentials() {
  printf '\n  Review it at %s/login\n' "$FRONTEND_URL"
  printf '  Login     %s / %s\n' "$DEMO_EMAIL" "$DEMO_PASSWORD"
  printf '  Workspace %s (id %s) → open the "Board" nav item\n' "$WORKSPACE_NAME" "$WORKSPACE_ID"
}

summary() {
  printf '\n  %d passed, %d failed\n' "$PASS" "$FAIL"
  if [ "$FAIL" -eq 0 ]; then
    echo "DEMO SEED PASSED"
    exit 0
  fi
  echo "DEMO SEED FAILED"
  exit 1
}

abort() {
  printf '\n  abort: %s\n' "$1"
  FAIL=$((FAIL + 1))
  credentials
  summary
}

echo "── demo workspace seed ──"
echo "   $FRONTEND_URL"

echo "[1] sign in (or create) the demo account"
http POST "$FRONTEND_URL/api/auth/login" \
  "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}"
if [ "$HTTP_CODE" != 200 ]; then
  http POST "$FRONTEND_URL/api/auth/register" \
    "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\",\"displayName\":\"Demo Owner\"}"
  if [ "$HTTP_CODE" != 201 ]; then
    abort "cannot login or register $DEMO_EMAIL (register → $HTTP_CODE). If the address exists with another password, rerun with DEMO_EMAIL=you@example.test"
  fi
  pass "demo account registered"
else
  pass "demo account logged in"
fi
TOKEN=$(json_str token "$HTTP_BODY")
[ -n "$TOKEN" ] || abort "no token in auth response"

echo "[2] find or create the workspace"
http GET "$FRONTEND_URL/api/workspaces" "" "$TOKEN"
# A workspace can be listed yet unusable: soft-deleted rows keep their slug
# and can still appear on the membership list, while the tenant filter
# rejects them (403). Probe each same-name candidate before trusting it.
WORKSPACE_ID=""
for CAND in $(printf '%s' "$HTTP_BODY" | tr '}' '\n' \
    | grep "\"name\":\"$WORKSPACE_NAME\"" | grep -o '"id":[0-9]*' | cut -d: -f2); do
  http GET "$FRONTEND_URL/api/pipeline/stages" "" "$TOKEN" "$CAND"
  if [ "$HTTP_CODE" = 200 ]; then WORKSPACE_ID="$CAND"; break; fi
done
if [ -n "$WORKSPACE_ID" ]; then
  pass "workspace '$WORKSPACE_NAME' exists and is usable (id $WORKSPACE_ID)"
else
  http POST "$FRONTEND_URL/api/workspaces" "{\"name\":\"$WORKSPACE_NAME\"}" "$TOKEN"
  if [ "$HTTP_CODE" != 201 ]; then
    abort "could not create '$WORKSPACE_NAME' (HTTP $HTTP_CODE): a deleted workspace may still hold its slug — rerun with a fresh DEMO_WORKSPACE_NAME"
  fi
  WORKSPACE_ID=$(json_num id "$HTTP_BODY")
  [ -n "$WORKSPACE_ID" ] || abort "workspace creation returned no id"
  pass "workspace '$WORKSPACE_NAME' created (id $WORKSPACE_ID)"
fi

echo "[3] skip if the board is already populated"
http GET "$FRONTEND_URL/api/pipeline/board" "" "$TOKEN" "$WORKSPACE_ID"
if [ "$HTTP_CODE" != 200 ]; then
  abort "board not readable (HTTP $HTTP_CODE)"
fi
# Count occurrences, not lines: the API answers are a single JSON line.
OFFERS_SEEN=$(printf '%s' "$HTTP_BODY" | grep -o '"seats":' | wc -l | tr -d ' ')
if [ "$OFFERS_SEEN" -gt 0 ]; then
  pass "board already has $OFFERS_SEEN offer(s) — leaving it untouched"
  credentials
  summary
fi
pass "board is empty — seeding"

echo "[4] lookups (seeded by workspace creation)"
http GET "$FRONTEND_URL/api/verticals" "" "$TOKEN" "$WORKSPACE_ID"
VERT_SALES=$(id_of "$HTTP_BODY" name "Sales")
VERT_ADV=$(id_of "$HTTP_BODY" name "Advertising")
VERT_PART=$(id_of "$HTTP_BODY" name "Partnerships")
http GET "$FRONTEND_URL/api/statuses" "" "$TOKEN" "$WORKSPACE_ID"
STATUS_BENCH=$(id_of "$HTTP_BODY" name "Bench")
STATUS_TRAIN=$(id_of "$HTTP_BODY" name "Training")
STATUS_INACT=$(id_of "$HTTP_BODY" name "Inactive")
http GET "$FRONTEND_URL/api/experience-levels" "" "$TOKEN" "$WORKSPACE_ID"
LVL_JUNIOR=$(id_of "$HTTP_BODY" name "Junior")
LVL_MID=$(id_of "$HTTP_BODY" name "Mid")
LVL_SENIOR=$(id_of "$HTTP_BODY" name "Senior")
if [ -z "$VERT_SALES$STATUS_BENCH$LVL_SENIOR" ]; then
  abort "default lookups missing — was this workspace created by an older build?"
fi
pass "verticals/statuses/levels resolved"

echo "[5] clients"
seed_client() { # <name> → id on stdout (diagnostics go to stderr: stdout
  # is captured by $(), so a printed FAIL line would pollute the id)
  http POST "$FRONTEND_URL/api/clients" "{\"name\":\"$1\"}" "$TOKEN" "$WORKSPACE_ID"
  if [ "$HTTP_CODE" != 201 ]; then fail "client '$1' (HTTP $HTTP_CODE): $HTTP_BODY" >&2; return 1; fi
  json_num id "$HTTP_BODY"
}
C_NORTHWIND=$(seed_client "Northwind Retail")
C_ACME=$(seed_client "Acme SaaS")
C_BLUEBIRD=$(seed_client "Bluebird Fintech")
C_VERDANT=$(seed_client "Verdant Health")
C_LUMEN=$(seed_client "Lumen Media")
if [ -z "$C_NORTHWIND$C_ACME$C_BLUEBIRD$C_VERDANT$C_LUMEN" ]; then
  abort "client seeding failed (see FAIL lines above)"
fi
pass "5 clients created"

echo "[6] reps with profiles (10 = the free plan cap)"
seed_rep() { # <json> → id
  http POST "$FRONTEND_URL/api/reps" "$1" "$TOKEN" "$WORKSPACE_ID"
  if [ "$HTTP_CODE" != 201 ]; then fail "rep creation (HTTP $HTTP_CODE): $1 $HTTP_BODY" >&2; return 1; fi
  json_num id "$HTTP_BODY"
}
R_AMARA=$(seed_rep "{\"name\":\"Amara Okafor\",\"verticalId\":$VERT_SALES,\"statusId\":$STATUS_BENCH,\"experienceLevelId\":$LVL_SENIOR,\"joinedDate\":\"2026-08-12\",\"bio\":\"Enterprise closer, 8 years across West African retail.\",\"timezone\":\"Africa/Lagos\",\"hoursPerWeek\":40,\"skills\":[\"Cold calling\",\"Objection handling\"],\"languages\":[\"English\"]}")
R_DIEGO=$(seed_rep "{\"name\":\"Diego Ramirez\",\"verticalId\":$VERT_SALES,\"statusId\":$STATUS_BENCH,\"experienceLevelId\":$LVL_MID,\"joinedDate\":\"2026-07-28\",\"timezone\":\"Europe/Madrid\",\"hoursPerWeek\":35,\"skills\":[\"Upselling\",\"CRM\"],\"languages\":[\"English\",\"Spanish\"]}")
R_PRIYA=$(seed_rep "{\"name\":\"Priya Nair\",\"verticalId\":$VERT_SALES,\"statusId\":$STATUS_TRAIN,\"experienceLevelId\":$LVL_JUNIOR,\"joinedDate\":\"2026-09-30\",\"timezone\":\"Asia/Kolkata\",\"hoursPerWeek\":40,\"skills\":[\"Lead gen\"],\"languages\":[\"English\",\"Hindi\"]}")
R_SOFIA=$(seed_rep "{\"name\":\"Sofia Almeida\",\"verticalId\":$VERT_ADV,\"statusId\":$STATUS_BENCH,\"experienceLevelId\":$LVL_SENIOR,\"joinedDate\":\"2026-06-15\",\"timezone\":\"America/Sao_Paulo\",\"hoursPerWeek\":30,\"skills\":[\"Programmatic\",\"Ad ops\"],\"languages\":[\"English\",\"Portuguese\"]}")
R_LUCAS=$(seed_rep "{\"name\":\"Lucas Meyer\",\"verticalId\":$VERT_ADV,\"statusId\":$STATUS_TRAIN,\"experienceLevelId\":$LVL_MID,\"joinedDate\":\"2026-09-10\",\"timezone\":\"Europe/Berlin\",\"hoursPerWeek\":20,\"skills\":[\"Paid social\"],\"languages\":[\"English\",\"German\"]}")
R_FATIMA=$(seed_rep "{\"name\":\"Fatima Hassan\",\"verticalId\":$VERT_PART,\"statusId\":$STATUS_BENCH,\"experienceLevelId\":$LVL_SENIOR,\"joinedDate\":\"2026-05-20\",\"timezone\":\"Asia/Dubai\",\"hoursPerWeek\":35,\"skills\":[\"Partnerships\",\"Negotiation\"],\"languages\":[\"English\",\"Arabic\"]}")
R_ETHAN=$(seed_rep "{\"name\":\"Ethan Brooks\",\"verticalId\":$VERT_SALES,\"statusId\":$STATUS_BENCH,\"experienceLevelId\":$LVL_MID,\"joinedDate\":\"2026-08-02\",\"timezone\":\"America/New_York\",\"hoursPerWeek\":40,\"skills\":[\"Cold calling\",\"Enterprise sales\"],\"languages\":[\"English\"]}")
R_YUKI=$(seed_rep "{\"name\":\"Yuki Tanaka\",\"verticalId\":$VERT_ADV,\"statusId\":$STATUS_BENCH,\"experienceLevelId\":$LVL_MID,\"joinedDate\":\"2026-07-05\",\"timezone\":\"Asia/Tokyo\",\"hoursPerWeek\":25,\"skills\":[\"Creative strategy\"],\"languages\":[\"English\",\"Japanese\"]}")
R_NADIA=$(seed_rep "{\"name\":\"Nadia Petrova\",\"verticalId\":$VERT_PART,\"statusId\":$STATUS_TRAIN,\"experienceLevelId\":$LVL_JUNIOR,\"joinedDate\":\"2026-09-22\",\"timezone\":\"Europe/Paris\",\"hoursPerWeek\":40,\"skills\":[\"Outreach\"],\"languages\":[\"English\",\"French\"]}")
R_MARCUS=$(seed_rep "{\"name\":\"Marcus Bell\",\"verticalId\":$VERT_SALES,\"statusId\":$STATUS_INACT,\"experienceLevelId\":$LVL_SENIOR,\"joinedDate\":\"2026-04-18\",\"timezone\":\"America/Chicago\",\"hoursPerWeek\":10,\"skills\":[\"Key accounts\"],\"languages\":[\"English\"]}")
if [ -z "$R_AMARA$R_DIEGO$R_PRIYA$R_SOFIA$R_LUCAS$R_FATIMA$R_ETHAN$R_YUKI$R_NADIA$R_MARCUS" ]; then
  abort "rep seeding failed (see FAIL lines above)"
fi
pass "10 reps created (5 will be benching, 5 placed)"

echo "[7] offers (created in Sourcing, then moved into place)"
seed_offer() { # <json> → id
  http POST "$FRONTEND_URL/api/offers" "$1" "$TOKEN" "$WORKSPACE_ID"
  if [ "$HTTP_CODE" != 201 ]; then fail "offer creation (HTTP $HTTP_CODE): $1 $HTTP_BODY" >&2; return 1; fi
  json_num id "$HTTP_BODY"
}
# Sourcing ×2
O_RETAIL=$(seed_offer "{\"clientId\":$C_NORTHWIND,\"verticalId\":$VERT_SALES,\"title\":\"Retail Sales Lead\",\"seats\":1,\"notes\":\"Flagship store rollout — needs a closer who can run a floor team.\"}")
O_MEDIA=$(seed_offer "{\"clientId\":$C_LUMEN,\"verticalId\":$VERT_ADV,\"title\":\"Media Buyer\",\"seats\":2,\"requiredSkills\":[\"Programmatic\"],\"startDate\":\"2026-11-16\"}")
# Interviewing ×2
O_BDR=$(seed_offer "{\"clientId\":$C_ACME,\"verticalId\":$VERT_SALES,\"title\":\"BDR Team Lead\",\"seats\":1,\"notes\":\"First management hire — interview loop with the VP Sales.\",\"requiredLevelId\":$LVL_MID,\"requiredLanguage\":\"English\"}")
O_SDR=$(seed_offer "{\"clientId\":$C_ACME,\"verticalId\":$VERT_SALES,\"title\":\"Outbound SDR\",\"seats\":2,\"requiredSkills\":[\"Cold calling\"],\"tzWindowStart\":480,\"tzWindowEnd\":1020}")
# Onboarding ×2
O_AE=$(seed_offer "{\"clientId\":$C_NORTHWIND,\"verticalId\":$VERT_SALES,\"title\":\"Enterprise AE\",\"seats\":2,\"requiredSkills\":[\"Cold calling\",\"Objection handling\"],\"requiredLevelId\":$LVL_SENIOR,\"requiredLanguage\":\"English\",\"startDate\":\"2026-11-02\",\"notes\":\"Marquee account — two seats, starts November.\"}")
O_CS=$(seed_offer "{\"clientId\":$C_VERDANT,\"verticalId\":$VERT_PART,\"title\":\"Client Success Manager\",\"seats\":2,\"notes\":\"Healthcare account renewals; HIPAA onboarding included.\"}")
# Live ×2
O_FINTech=$(seed_offer "{\"clientId\":$C_BLUEBIRD,\"verticalId\":$VERT_PART,\"title\":\"Partnership Manager\",\"seats\":1,\"notes\":\"Banking partnerships — live since September.\"}")
O_GROWTH=$(seed_offer "{\"clientId\":$C_LUMEN,\"verticalId\":$VERT_ADV,\"title\":\"Growth Marketer\",\"seats\":3,\"requiredSkills\":[\"Paid social\"],\"startDate\":\"2026-10-05\"}")
if [ -z "$O_RETAIL$O_MEDIA$O_BDR$O_SDR$O_AE$O_CS$O_FINTech$O_GROWTH" ]; then
  abort "offer seeding failed (see FAIL lines above)"
fi
pass "8 offers created"

echo "[8] move 6 offers into their board columns"
# Stage ids come from one fetch (name → id).
http GET "$FRONTEND_URL/api/pipeline/stages" "" "$TOKEN" "$WORKSPACE_ID"
S_INTERVIEW=$(id_of "$HTTP_BODY" name "Interviewing")
S_ONBOARD=$(id_of "$HTTP_BODY" name "Onboarding")
S_LIVE=$(id_of "$HTTP_BODY" name "Live")
if [ -z "$S_INTERVIEW$S_ONBOARD$S_LIVE" ]; then
  abort "pipeline stages missing"
fi
mv_offer() { # <offer-id> <stage-id>
  http POST "$FRONTEND_URL/api/offers/$1/stage" "{\"stageId\":$2}" "$TOKEN" "$WORKSPACE_ID"
  if [ "$HTTP_CODE" != 200 ]; then fail "move offer $1 (HTTP $HTTP_CODE)"; fi
}
BEFORE_MOVES=$FAIL
mv_offer "$O_BDR" "$S_INTERVIEW"
mv_offer "$O_SDR" "$S_INTERVIEW"
mv_offer "$O_AE" "$S_ONBOARD"
mv_offer "$O_CS" "$S_ONBOARD"
mv_offer "$O_FINTech" "$S_LIVE"
mv_offer "$O_GROWTH" "$S_LIVE"
if [ "$FAIL" -eq "$BEFORE_MOVES" ]; then
  pass "offers distributed across Interviewing / Onboarding / Live"
fi

echo "[9] placements (5 active: Enterprise AE 2/2 filled, the rest partial)"
place() { # <offer-id> <rep-id> <label>
  http POST "$FRONTEND_URL/api/placements" "{\"offerId\":$1,\"repId\":$2}" "$TOKEN" "$WORKSPACE_ID"
  if [ "$HTTP_CODE" != 201 ]; then fail "placement $3 (HTTP $HTTP_CODE): $HTTP_BODY"; fi
}
BEFORE_PLACES=$FAIL
place "$O_AE" "$R_DIEGO" "Diego → Enterprise AE"
place "$O_AE" "$R_ETHAN" "Ethan → Enterprise AE"
place "$O_CS" "$R_FATIMA" "Fatima → Client Success"
# Amara goes to Growth Marketer, NOT BDR Team Lead: BDR is a 1-seat offer in
# Interviewing — placing anyone there would instantly FILLED it, contradicting
# that column's story (only Enterprise AE ends up filled, 2/2).
place "$O_GROWTH" "$R_AMARA" "Amara → Growth Marketer"
place "$O_GROWTH" "$R_SOFIA" "Sofia → Growth Marketer"
if [ "$FAIL" -eq "$BEFORE_PLACES" ]; then
  pass "5 placements created"
fi

echo "[10] verify what the board and roster will show"
http GET "$FRONTEND_URL/api/pipeline/board" "" "$TOKEN" "$WORKSPACE_ID"
BOARD_SUMMARY=$(printf '%s' "$HTTP_BODY" | awk 'BEGIN { RS = "\\{\"stage\":" }
  NR > 1 {
    if (match($0, /"name":"[^"]*"/)) { name = substr($0, RSTART + 8, RLENGTH - 9) }
    n = gsub(/"seats":/, "x", $0)
    printf "%s=%d ", name, n
  }')
check "board columns" "Sourcing=2 Interviewing=2 Onboarding=2 Live=2 " "$BOARD_SUMMARY"

http GET "$FRONTEND_URL/api/reps?size=100" "" "$TOKEN" "$WORKSPACE_ID"
check "roster total" 10 "$(json_num total "$HTTP_BODY")"

# /api/placements needs an offerId/repId filter, so count per carrying offer.
ACTIVE=0
for PLACED_OFFER in "$O_AE" "$O_CS" "$O_GROWTH"; do
  http GET "$FRONTEND_URL/api/placements?offerId=$PLACED_OFFER" "" "$TOKEN" "$WORKSPACE_ID"
  FOUND=$(printf '%s' "$HTTP_BODY" | grep -oi '"status":"active"' | wc -l | tr -d ' ')
  ACTIVE=$((ACTIVE + FOUND))
done
check "active placements" 5 "$ACTIVE"

http GET "$FRONTEND_URL/api/offers?effectiveStatus=FILLED" "" "$TOKEN" "$WORKSPACE_ID"
check "one offer is FILLED" 1 "$(printf '%s' "$HTTP_BODY" | grep -o '"seats":' | wc -l | tr -d ' ')"

credentials
summary
