#!/usr/bin/env bash
#
# start-dev.sh — bring up the whole local dev stack with one command:
#
#   1. MySQL :3306        (skipped if already listening; docker compose if
#                          docker exists, else native mysqld from the toolchain)
#   2. Backend  :8080     (mvn spring-boot:run; Flyway migrates on boot)
#   3. Frontend :5173     (Vite; proxies /api to the backend)
#   4. Tunnel           (Cloudflare quick tunnel -> public URL for :5173)
#
# Idempotent: anything already listening is left alone, so it is safe to
# re-run while parts of the stack are up. Every component's output goes to
# logs/<component>.log. Exits non-zero if any component fails its readiness
# check, naming the log to look at.
#
# Toolchain discovery: sources $TOOLCHAIN_ENV, else ~/toolchain/env.sh if
# present (that is where JDK/Maven/MySQL/Node get on PATH); otherwise relies
# on the calling shell's PATH.
#
# Override: CLOUDFLARED=/path/to/cloudflared, MYSQL_DATADIR=/path/to/data

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

# --- toolchain (JDK 21, Maven, MySQL, Node) -----------------------------
ENV_SH="${TOOLCHAIN_ENV:-$HOME/toolchain/env.sh}"
TOOLCHAIN_DIR=""
if [ -f "$ENV_SH" ]; then
  # shellcheck source=/dev/null
  . "$ENV_SH"
  TOOLCHAIN_DIR="$(cd "$(dirname "$ENV_SH")" && pwd)"
fi

log() { printf '%s\n' "$*"; }
fail() { log "✗ $1 — see $2"; exit 1; }

# True if some process listens on the given local TCP port.
port_open() {
  netstat -ano 2>/dev/null \
    | awk -v p=":$1" '$4 == "LISTENING" && substr($2, length($2) - length(p) + 1) == p { found = 1 } END { exit !found }'
}

# wait_for <label> <timeout-seconds> <command...> — poll until it succeeds.
wait_for() {
  local label=$1 timeout=$2 waited=0
  shift 2
  until "$@" >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$timeout" ]; then
      return 1
    fi
  done
  log "✓ ${label} ready (${waited}s)"
  return 0
}

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null; }
http_200() { [ "$(http_code "$1")" = "200" ]; }
backend_healthy() { curl -s --max-time 5 http://localhost:8080/actuator/health 2>/dev/null | grep -q '"status":"UP"'; }
tunnel_registered() {
  grep -Eq 'https://[a-z0-9-]+\.trycloudfla[a-z]+\.com' "$LOG_DIR/tunnel.log" 2>/dev/null
}

# cygpath -m so Windows-native binaries (mysqld.exe) get C:/... paths.
winpath() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

find_cloudflared() {
  if [ -n "${CLOUDFLARED:-}" ]; then printf '%s' "$CLOUDFLARED"; return 0; fi
  if command -v cloudflared >/dev/null 2>&1; then command -v cloudflared; return 0; fi
  if [ -n "$TOOLCHAIN_DIR" ] && [ -f "$TOOLCHAIN_DIR/cloudflared.exe" ]; then
    printf '%s' "$TOOLCHAIN_DIR/cloudflared.exe"; return 0
  fi
  return 1
}

# PID of a cloudflared quick tunnel already serving localhost:5173, if any.
tunnel_pid() {
  if command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command \
      "Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { \$_.CommandLine -like '*localhost:5173*' } | Select-Object -First 1 -ExpandProperty ProcessId" \
      2>/dev/null | tr -d '\r'
  elif command -v pgrep >/dev/null 2>&1; then
    pgrep -f 'cloudflared.*--url.*5173' 2>/dev/null | head -1
  fi
}

# Export KEY=VALUE lines from .env if present (backend config; see .env.example).
if [ -f "$ROOT/.env" ]; then
  while IFS= read -r line; do
    [[ $line =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && export "$line"
  done < "$ROOT/.env"
fi

# --- 1. MySQL ------------------------------------------------------------
if port_open 3306; then
  log "✓ MySQL already running on :3306"
elif command -v docker >/dev/null 2>&1 && [ -f "$ROOT/docker-compose.yml" ]; then
  log "→ starting MySQL (docker compose up -d)…"
  (cd "$ROOT" && docker compose up -d) || fail "docker compose up failed" "$LOG_DIR/mysql.log"
  wait_for "MySQL :3306" 60 port_open 3306 || fail "MySQL did not open :3306" "$LOG_DIR/mysql.log"
elif command -v mysqld >/dev/null 2>&1; then
  # Resolve the datadir: explicit MYSQL_DATADIR wins, else the first candidate
  # that holds the mysql system schema (layouts differ across distributions).
  BIN_DIR="$(dirname "$(command -v mysqld)")"
  DATADIR="${MYSQL_DATADIR:-}"
  if [ -z "$DATADIR" ]; then
    for cand in "$BIN_DIR/../data" "$BIN_DIR/../../data"; do
      if [ -d "$cand/mysql" ]; then DATADIR="$cand"; break; fi
    done
  fi
  [ -n "$DATADIR" ] && [ -d "$DATADIR" ] || fail "MySQL data dir not found (tried $BIN_DIR/../data, $BIN_DIR/../../data) — set MYSQL_DATADIR" "$LOG_DIR/mysql.log"
  # Refuse an uninitialized datadir — mysqld would come up empty or not at all.
  [ -d "$DATADIR/mysql" ] || fail "MySQL data dir has no system schema (uninitialized?): $DATADIR — set MYSQL_DATADIR" "$LOG_DIR/mysql.log"
  log "→ starting MySQL (mysqld, datadir=$(winpath "$DATADIR"))…"
  # nohup + & detaches each service from this script; nohup alone is enough
  # (the script is non-interactive, so children are orphaned, not HUP'd).
  nohup mysqld --no-defaults --basedir="$(winpath "$(dirname "$(command -v mysqld)")/..")" \
    --datadir="$(winpath "$DATADIR")" --port=3306 --console \
    >"$LOG_DIR/mysql.log" 2>&1 &
  wait_for "MySQL :3306" 60 port_open 3306 || fail "mysqld did not open :3306" "$LOG_DIR/mysql.log"
else
  log "✗ MySQL is not running and cannot be started (no docker, mysqld not on PATH)."
  log "  Install/start MySQL 8 or source your toolchain env.sh, then re-run."
  exit 1
fi

# --- 2. Backend ----------------------------------------------------------
if port_open 8080; then
  log "✓ Backend already running on :8080"
else
  if ! command -v mvn >/dev/null 2>&1; then
    log "✗ mvn not found — source your toolchain env.sh (JDK 21 + Maven) and re-run."
    exit 1
  fi
  log "→ starting backend (mvn spring-boot:run)…"
  (cd "$ROOT/backend" && nohup mvn spring-boot:run >"$LOG_DIR/backend.log" 2>&1 &)
  wait_for "Backend :8080" 240 backend_healthy || fail "backend did not become healthy" "$LOG_DIR/backend.log"
fi

# --- 3. Frontend ---------------------------------------------------------
if port_open 5173; then
  log "✓ Frontend already running on :5173"
else
  if ! command -v npm >/dev/null 2>&1; then
    log "✗ npm not found — source your toolchain env.sh (Node) and re-run."
    exit 1
  fi
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    log "→ installing frontend dependencies (npm install)…"
    (cd "$ROOT/frontend" && npm install) || fail "npm install failed" "$LOG_DIR/frontend.log"
  fi
  log "→ starting frontend (vite)…"
  (cd "$ROOT/frontend" && nohup npm run dev >"$LOG_DIR/frontend.log" 2>&1 &)
  wait_for "Frontend :5173" 60 http_200 http://localhost:5173/ || fail "vite did not serve :5173" "$LOG_DIR/frontend.log"
fi

# --- 4. Cloudflare quick tunnel (public URL for the frontend) ------------
TUNNEL_URL=""
if [ -n "$(tunnel_pid)" ]; then
  log "✓ Tunnel already running for localhost:5173"
  TUNNEL_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudfla[a-z]+\.com' "$LOG_DIR/tunnel.log" 2>/dev/null | head -1)"
  [ -n "$TUNNEL_URL" ] || log "  (started outside this script — its URL is in its own console)"
else
  if CF="$(find_cloudflared)"; then
    log "→ starting Cloudflare quick tunnel…"
    nohup "$CF" tunnel --url http://localhost:5173 >"$LOG_DIR/tunnel.log" 2>&1 &
    wait_for "tunnel registration" 90 tunnel_registered || fail "tunnel never registered" "$LOG_DIR/tunnel.log"
    TUNNEL_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudfla[a-z]+\.com' "$LOG_DIR/tunnel.log" | head -1)"
    if [ -n "$TUNNEL_URL" ]; then
      wait_for "tunnel HTTP" 60 http_200 "$TUNNEL_URL" || log "✗ tunnel URL not answering yet — check $LOG_DIR/tunnel.log"
    fi
  else
    log "✗ cloudflared not found (PATH, $TOOLCHAIN_DIR/cloudflared.exe, or CLOUDFLARED=…) — skipping tunnel."
  fi
fi

# --- summary -------------------------------------------------------------
log ""
log "──────────────────────────────────────────────"
log " MySQL     :3306   $(port_open 3306 && echo up || echo DOWN)"
log " Backend   :8080   http://localhost:8080"
log " Frontend  :5173   http://localhost:5173"
if [ -n "$TUNNEL_URL" ]; then
  log " Public           $TUNNEL_URL"
else
  log " Public           (no tunnel)"
fi
log " Logs              $LOG_DIR/{mysql,backend,frontend,tunnel}.log"
log "──────────────────────────────────────────────"
