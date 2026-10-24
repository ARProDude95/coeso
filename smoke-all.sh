#!/usr/bin/env bash
# smoke-all.sh — both live-stack smoke suites, one command, one verdict.
#
#   ./start-dev.sh && ./smoke-all.sh
#
# Runs the two existing end-to-end smokes back-to-back against the running dev
# stack, leaving their output exactly as it is so a failure is still readable
# in place:
#
#   1. smoke-test.sh       roster/pipeline: register → workspace seed → client
#                          + offer → board → stage move → auth negatives
#   2. smoke-community.sh  community: intros profile → invite lifecycle → pod
#                          generation/publish → private thread → negatives
#
# Each suite is independent — its own accounts, its own workspace, its own
# cleanup — so the order only affects what you read first. Both are repeatable:
# a suite that fails does not stop the next one from running, because a red
# community suite is usually more informative than an aborted run.
#
# Prints a summary table and a single verdict; exits 0 only when BOTH suites
# exit 0. Assert counts are summed from each suite's own "N passed, M failed"
# line and are informational — the exit statuses decide the verdict.
#
# Overrides (exported straight through to both suites): BACKEND_URL,
# FRONTEND_URL.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
export BACKEND_URL FRONTEND_URL

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

LABELS=()
SCRIPTS=()
STATUSES=()
SECONDS_USED=()
ASSERTS_PASSED=()
ASSERTS_FAILED=()

run_suite() { # <label> <script-name>
  local label=$1 name=$2 script="$ROOT/$2" log="$WORK/$2.log"
  local status start elapsed passed failed totals

  printf '\n── %s ──\n' "$label"

  if [ ! -f "$script" ]; then
    printf '  FAIL %s not found next to this wrapper\n' "$name"
    status=127
    passed=0
    failed=0
    elapsed=0
  else
    start=$SECONDS
    # Stream the suite's own output live and keep a copy for the tallies.
    bash "$script" 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
    elapsed=$((SECONDS - start))
    # Last "N passed, M failed" line wins: each suite prints exactly one, at
    # the end of its cleanup step.
    totals=$(awk '/^[[:space:]]*[0-9]+ passed, [0-9]+ failed/ {
                    p = $1; f = $3
                  }
                  END { printf "%d %d", p, f }' "$log")
    passed=${totals%% *}
    failed=${totals##* }
    passed=${passed:-0}
    failed=${failed:-0}
  fi

  LABELS+=("$label")
  SCRIPTS+=("$name")
  STATUSES+=("$status")
  SECONDS_USED+=("$elapsed")
  ASSERTS_PASSED+=("$passed")
  ASSERTS_FAILED+=("$failed")
}

echo "════ all smoke suites ──"
echo "   frontend $FRONTEND_URL · backend $BACKEND_URL"

run_suite "pipeline smoke" "smoke-test.sh"
run_suite "community smoke" "smoke-community.sh"

printf '\n════ smoke-all verdict ──\n'
total_passed=0
total_failed=0
suites_ok=0
suites_run=${#SCRIPTS[@]}

for i in "${!SCRIPTS[@]}"; do
  status=${STATUSES[$i]}
  if [ "$status" -eq 0 ]; then
    verdict=PASS
    suites_ok=$((suites_ok + 1))
  else
    verdict="FAIL (exit $status)"
  fi
  printf '  %-18s %-14s %3ss  %d passed, %d failed\n' \
    "${SCRIPTS[$i]}" "$verdict" "${SECONDS_USED[$i]}" \
    "${ASSERTS_PASSED[$i]}" "${ASSERTS_FAILED[$i]}"
  total_passed=$((total_passed + ASSERTS_PASSED[$i]))
  total_failed=$((total_failed + ASSERTS_FAILED[$i]))
done

total_asserts=$((total_passed + total_failed))
echo

if [ "$suites_ok" -eq "$suites_run" ]; then
  echo "SMOKE SUITE PASSED — $suites_ok/$suites_run suites, $total_passed/$total_asserts asserts"
  exit 0
fi

echo "SMOKE SUITE FAILED — $suites_ok/$suites_run suites, $total_passed/$total_asserts asserts"
exit 1
