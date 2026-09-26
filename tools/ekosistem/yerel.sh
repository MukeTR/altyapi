#!/usr/bin/env bash
# Local three-product ecosystem (docs/ekosistem/yerel-kurulum.md): altyapi API + worker from
# this tree, Kârmatik (vite dev on the local Supabase stack) and Yanıt (next dev on the local
# Postgres). Nothing here talks to a live database: every service is refused when its env
# file points anywhere but the local machine.
#
#   yerel.sh up [servis…]      start (default: all), wait for health
#   yerel.sh down [servis…]    stop what this script started (default: all)
#   yerel.sh status            services, dependencies and guards
#   yerel.sh logs <servis> [-f]
#   yerel.sh tick              call the scheduled-job endpoints once, in order
#   yerel.sh tohum             run the altyapi seed (tohum-altyapi.ts; API must be up)
#   yerel.sh test              end-to-end tests (skeleton)
#
# Services: altyapi-api (:4000), altyapi-worker (:4100 health), karmatik (:3999), yanit (:3200).
# Override locations with KARMATIK_DIR, YANIT_DIR, UYGULAMA_DIR, NODE22_BIN.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/tools/ekosistem/.yerel"
KIMLIK="$STATE/kimlikler.env"
KARMATIK_DIR="${KARMATIK_DIR:-/Users/macos/karmatikdev}"
YANIT_DIR="${YANIT_DIR:-/Users/macos/yanit-wt/ekosistem}"
UYGULAMA_DIR="${UYGULAMA_DIR:-/Users/macos/altyapi-uygulama}"
NODE22_BIN="${NODE22_BIN:-/opt/homebrew/opt/node@22/bin}"

SERVICES=(altyapi-api altyapi-worker karmatik yanit)

# Peer addresses (PLAN.md): every product reads its peers from the environment.
ALTYAPI_BASE="http://localhost:4000"
KARMATIK_BASE="http://localhost:3999/api/public"
YANIT_BASE="http://localhost:3200/api"

# Keys of Kârmatik's .env that must never reach the dev server unless overridden locally.
KARMATIK_URL_KEYS=(SUPABASE_URL VITE_SUPABASE_URL)
LIVE_PATTERN='supabase\.co|udlmhjozkihasspfgzkp|vtuavcgggkykprihtjgb|karmatik\.io|yanit\.io|altyapi\.io'

mkdir -p "$STATE"
chmod 700 "$STATE" 2>/dev/null || true

say() { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }

port_of() {
  case "$1" in
    altyapi-api) echo 4000 ;;
    altyapi-worker) echo 4100 ;;
    karmatik) echo 3999 ;;
    yanit) echo 3200 ;;
  esac
}

health_url() {
  case "$1" in
    altyapi-api) echo "http://localhost:4000/readyz" ;;
    altyapi-worker) echo "http://localhost:4100/healthz" ;;
    karmatik) echo "http://localhost:3999/api/public/version" ;;
    yanit) echo "http://localhost:3200/api/health" ;;
  esac
}

# Seconds to wait for a healthy answer (first vite / next compile is slow).
health_timeout() {
  case "$1" in
    altyapi-api | altyapi-worker) echo 90 ;;
    karmatik) echo 180 ;;
    yanit) echo 240 ;;
  esac
}

is_service() {
  local s
  for s in "${SERVICES[@]}"; do [[ "$s" == "$1" ]] && return 0; done
  return 1
}

# ---------------------------------------------------------------------------
# Env files
# ---------------------------------------------------------------------------

# Last value of KEY in an env file (quotes stripped). Never printed by callers.
env_value() {
  local file="$1" key="$2" v
  [[ -f "$file" ]] || return 1
  v="$(sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}${key}=//p" "$file" | tail -n 1)"
  v="${v%$'\r'}"
  v="${v#\"}"
  v="${v%\"}"
  v="${v#\'}"
  v="${v%\'}"
  printf '%s' "$v"
}

has_key() {
  [[ -f "$1" ]] && grep -Eq "^[[:space:]]*(export[[:space:]]+)?$2=" "$1"
}

# Host part of a URL (scheme, credentials, port and path removed).
url_host() {
  local u="${1#*://}"
  u="${u##*@}"
  u="${u%%/*}"
  u="${u%%\?*}"
  if [[ "$u" == \[* ]]; then
    u="${u%%]*}]"
  else
    u="${u%%:*}"
  fi
  printf '%s' "$u"
}

url_port() {
  local u="${1#*://}"
  u="${u##*@}"
  u="${u%%/*}"
  u="${u%%\?*}"
  [[ "$u" == \[* ]] && u="${u#*]}"
  [[ "$u" == *:* ]] && printf '%s' "${u##*:}"
}

is_local_url() {
  [[ -n "$1" ]] || return 1
  case "$(url_host "$1")" in
    localhost | 127.0.0.1 | "[::1]" | ::1) return 0 ;;
    *) return 1 ;;
  esac
}

# Kârmatik: the dev server loads .env (LIVE values) and .env.development.local on top of it.
# Only a local .env.development.local that overrides every live-looking key may start it.
karmatik_env_ok() {
  local dev="$KARMATIK_DIR/.env.development.local" base="$KARMATIK_DIR/.env" key v
  if [[ ! -f "$dev" ]]; then
    warn "karmatik: $dev yok (L1 henüz hazırlamadı) — başlatılmadı."
    return 1
  fi
  for key in "${KARMATIK_URL_KEYS[@]}"; do
    v="$(env_value "$dev" "$key")"
    if ! is_local_url "$v"; then
      warn "karmatik: .env.development.local içindeki $key yerel değil (host: $(url_host "$v")) — CANLI tehlikesi, başlatılmadı."
      return 1
    fi
  done
  if [[ -f "$base" ]]; then
    while IFS= read -r key; do
      [[ -n "$key" ]] || continue
      if ! has_key "$dev" "$key"; then
        warn "karmatik: .env içindeki $key canlı bir adres içeriyor ve .env.development.local onu ezmiyor — başlatılmadı."
        return 1
      fi
      if env_value "$dev" "$key" | grep -Eq "$LIVE_PATTERN"; then
        warn "karmatik: .env.development.local içindeki $key canlı bir adres içeriyor — başlatılmadı."
        return 1
      fi
    done < <(grep -E "^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=.*($LIVE_PATTERN)" "$base" | sed -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/' | sort -u)
  fi
  return 0
}

# Prisma env file a generated client falls back to (null when generated without one).
prisma_schema_env_files() {
  local idx dir rel
  for idx in "$YANIT_DIR"/node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/index.js; do
    [[ -f "$idx" ]] || continue
    dir="$(dirname "$idx")"
    rel="$(grep -Eo '"schemaEnvPath": *"[^"]+"' "$idx" | head -n 1 | sed -E 's/.*: *"([^"]+)"/\1/')"
    [[ -n "$rel" ]] && (cd "$dir" && cd "$(dirname "$rel")" 2>/dev/null && printf '%s/%s\n' "$(pwd)" "$(basename "$rel")")
  done
  [[ -f "$YANIT_DIR/packages/db/.env" ]] && printf '%s\n' "$YANIT_DIR/packages/db/.env"
  return 0
}

# Yanıt: next dev reads apps/web/.env.local first; packages/db/.env (LIVE in the main checkout)
# may still be loaded by Prisma for keys .env.local does not set.
yanit_env_ok() {
  local env="$YANIT_DIR/apps/web/.env.local" v key f
  if [[ ! -d "$YANIT_DIR" ]]; then
    warn "yanit: $YANIT_DIR yok (Y1 henüz hazırlamadı) — başlatılmadı."
    return 1
  fi
  if [[ ! -f "$env" ]]; then
    warn "yanit: $env yok (Y1 henüz hazırlamadı) — başlatılmadı."
    return 1
  fi
  v="$(env_value "$env" DATABASE_URL)"
  if ! is_local_url "$v"; then
    warn "yanit: apps/web/.env.local DATABASE_URL yerel değil (host: $(url_host "$v")) — CANLI tehlikesi, başlatılmadı."
    return 1
  fi
  if has_key "$env" DIRECT_URL && ! is_local_url "$(env_value "$env" DIRECT_URL)"; then
    warn "yanit: apps/web/.env.local DIRECT_URL yerel değil — başlatılmadı."
    return 1
  fi
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    for key in DATABASE_URL DIRECT_URL; do
      v="$(env_value "$f" "$key")"
      [[ -n "$v" ]] || continue
      if ! is_local_url "$v" && ! has_key "$env" "$key"; then
        warn "yanit: $f içindeki $key yerel değil ve .env.local onu ezmiyor — başlatılmadı."
        return 1
      fi
    done
  done < <(prisma_schema_env_files)
  return 0
}

# ---------------------------------------------------------------------------
# Processes and ports
# ---------------------------------------------------------------------------

pid_file() { echo "$STATE/$1.pid"; }
log_file() { echo "$STATE/$1.log"; }

# pid file: "<pgid> <marker>"; the marker must still appear in the leader's command or cwd.
service_pgid() {
  local f pgid marker cmd cwd
  f="$(pid_file "$1")"
  [[ -f "$f" ]] || return 1
  read -r pgid marker <"$f" || return 1
  [[ "$pgid" =~ ^[0-9]+$ ]] || return 1
  if ! kill -0 "$pgid" 2>/dev/null; then
    # The leader may have exited while children of the group keep serving.
    pgrep -g "$pgid" >/dev/null 2>&1 || return 1
    printf '%s' "$pgid"
    return 0
  fi
  cmd="$(ps -o command= -p "$pgid" 2>/dev/null)"
  cwd="$(lsof -a -p "$pgid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [[ -z "$marker" || "$cmd" == *"$marker"* || "$cwd" == *"$marker"* ]] || return 1
  printf '%s' "$pgid"
}

listeners() { lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u; }

describe_pid() {
  local pid="$1" cmd cwd
  cmd="$(ps -o command= -p "$pid" 2>/dev/null | cut -c1-160)"
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  printf 'pid %s · %s · cwd %s' "$pid" "${cmd:-?}" "${cwd:-?}"
}

# True when every listener of the service port belongs to the process group we started.
port_is_ours() {
  local svc="$1" port pgid pid pg any=1
  port="$(port_of "$svc")"
  pgid="$(service_pgid "$svc")" || return 1
  for pid in $(listeners "$port"); do
    any=0
    pg="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [[ "$pg" == "$pgid" ]] || return 1
  done
  return $any
}

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-5}" "$1" 2>/dev/null || true; }

# API / worker processes started from the altyapi-uygulama worktree (same DB and Redis: its
# worker would take ekosistem jobs without peer addresses, see docs/ekosistem/yerel-kurulum.md).
uygulama_processes() {
  local pid cmd cwd exe
  while read -r pid cmd; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    # Only the runtimes that serve the API / worker (not shells that merely mention the paths).
    exe="${cmd%% *}"
    case "${exe##*/}" in node | tsx | pnpm | npm | turbo) ;; *) continue ;; esac
    case "$cmd" in
      *src/main.ts* | *src/server.ts* | *dist/main.js* | *dist/server.js* | *@altyapi/worker* | *@altyapi/api* | *"turbo run dev"* | *"$UYGULAMA_DIR"*) ;;
      *) continue ;;
    esac
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    [[ "$cmd" == *"$UYGULAMA_DIR"* || "$cwd" == "$UYGULAMA_DIR"* ]] || continue
    case "$cmd $cwd" in
      *apps/worker* | *apps/api* | *@altyapi/worker* | *@altyapi/api* | *"turbo run dev"*) printf '%s\t%s\t%s\n' "$pid" "$cwd" "$(printf '%s' "$cmd" | cut -c1-160)" ;;
    esac
  done < <(ps -Ao pid=,command=)
}

docker_running() { docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$1"; }

deps_ok() {
  local svc="$1" c ok=0
  case "$svc" in
    altyapi-api | altyapi-worker)
      for c in altyapi-postgres-1 altyapi-valkey-1; do
        docker_running "$c" || { warn "$svc: docker konteyneri $c çalışmıyor (cd $ROOT && docker compose up -d)."; ok=1; }
      done
      docker_running altyapi-minio-1 || warn "$svc: altyapi-minio-1 çalışmıyor; medya yükleme çalışmaz (servis yine başlatılır)."
      ;;
    karmatik)
      for c in supabase_db_udlmhjozkihasspfgzkp supabase_kong_udlmhjozkihasspfgzkp supabase_auth_udlmhjozkihasspfgzkp supabase_rest_udlmhjozkihasspfgzkp; do
        docker_running "$c" || { warn "karmatik: docker konteyneri $c çalışmıyor (docker start $c). karmatikdev içinde 'supabase start' ÇALIŞTIRMA."; ok=1; }
      done
      ;;
    yanit)
      local url host port
      url="$(env_value "$YANIT_DIR/apps/web/.env.local" DATABASE_URL)"
      host="$(url_host "$url")"
      port="$(url_port "$url")"
      port="${port:-5432}"
      if command -v nc >/dev/null 2>&1 && ! nc -z "${host//[\[\]]/}" "$port" >/dev/null 2>&1; then
        warn "yanit: veritabanı $host:$port erişilemiyor (brew services start postgresql@17)."
        ok=1
      fi
      [[ -x "$NODE22_BIN/node" ]] || { warn "yanit: Node 22 bulunamadı ($NODE22_BIN/node)."; ok=1; }
      ;;
  esac
  return $ok
}

env_ok() {
  case "$1" in
    altyapi-api | altyapi-worker)
      local db
      db="$(env_value "$ROOT/.env" DATABASE_URL)"
      if ! is_local_url "$db"; then
        warn "$1: $ROOT/.env DATABASE_URL yerel değil — başlatılmadı."
        return 1
      fi
      [[ "$(env_value "$ROOT/.env" APP_ENV)" == "local" ]] || { warn "$1: APP_ENV=local değil — eşler için localhost kabul edilmez, başlatılmadı."; return 1; }
      ;;
    karmatik) karmatik_env_ok || return 1 ;;
    yanit) yanit_env_ok || return 1 ;;
  esac
  return 0
}

# Starts a command in its own process group (so `down` stops the whole tree) with a clean
# environment: nothing from the caller's shell (e.g. an exported live SUPABASE_URL) leaks in.
spawn() {
  local svc="$1" dir="$2" marker="$3" path="$4"
  shift 4
  local log pid
  log="$(log_file "$svc")"
  printf '\n===== %s %s =====\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$svc" >>"$log"
  (
    cd "$dir" || exit 1
    exec env -i HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-}" LANG="${LANG:-en_US.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
      PATH="$path" TERM=dumb NO_COLOR=1 "$@" \
      perl -e '$SIG{HUP} = "IGNORE"; setpgrp(0, 0); exec @ARGV or die "exec: $!"' -- "${SPAWN_CMD[@]}"
  ) >>"$log" 2>&1 </dev/null &
  pid=$!
  printf '%s %s\n' "$pid" "$marker" >"$(pid_file "$svc")"
  say "  $svc başlatıldı (pgid $pid) · log: $log"
}

start_service() {
  local svc="$1" port pid base_path="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  port="$(port_of "$svc")"
  if service_pgid "$svc" >/dev/null; then
    say "  $svc zaten çalışıyor (ya da açılıyor)."
    return 0
  fi
  local busy
  busy="$(listeners "$port")"
  if [[ -n "$busy" ]]; then
    warn "$svc: port $port dolu, atlandı:"
    for pid in $busy; do warn "    $(describe_pid "$pid")"; done
    return 1
  fi
  env_ok "$svc" || return 1
  deps_ok "$svc" || { warn "$svc: bağımlılıklar eksik, atlandı."; return 1; }
  case "$svc" in
    altyapi-api)
      SPAWN_CMD=(node --env-file=../../.env --import tsx src/server.ts)
      spawn "$svc" "$ROOT/apps/api" "$ROOT/apps/api" "$base_path" \
        EKOSISTEM_PEER_BASE_KARMATIK="$KARMATIK_BASE" EKOSISTEM_PEER_BASE_YANIT="$YANIT_BASE"
      ;;
    altyapi-worker)
      SPAWN_CMD=(node --env-file=../../.env --import tsx src/main.ts)
      spawn "$svc" "$ROOT/apps/worker" "$ROOT/apps/worker" "$base_path" \
        EKOSISTEM_PEER_BASE_KARMATIK="$KARMATIK_BASE" EKOSISTEM_PEER_BASE_YANIT="$YANIT_BASE"
      ;;
    karmatik)
      [[ -x "$KARMATIK_DIR/node_modules/.bin/vite" ]] || { warn "karmatik: node_modules/.bin/vite yok (bun install)."; return 1; }
      SPAWN_CMD=(./node_modules/.bin/vite dev --port 3999 --strictPort)
      spawn "$svc" "$KARMATIK_DIR" "$KARMATIK_DIR" "$base_path" \
        EKOSISTEM_APP_ENV=local EKOSISTEM_PEER_BASE_ALTYAPI="$ALTYAPI_BASE" EKOSISTEM_PEER_BASE_YANIT="$YANIT_BASE"
      ;;
    yanit)
      SPAWN_CMD=(pnpm --filter @yanit/web exec next dev -p 3200)
      spawn "$svc" "$YANIT_DIR" "$YANIT_DIR" "$NODE22_BIN:$base_path" \
        EKOSISTEM_PEER_BASE_ALTYAPI="$ALTYAPI_BASE" EKOSISTEM_PEER_BASE_KARMATIK="$KARMATIK_BASE"
      ;;
  esac
  return 0
}

wait_healthy() {
  local svc="$1" url limit started code
  url="$(health_url "$svc")"
  limit="$(health_timeout "$svc")"
  started=$SECONDS
  while ((SECONDS - started < limit)); do
    if ! service_pgid "$svc" >/dev/null; then
      warn "$svc: süreç erken çıktı. Son log satırları:"
      tail -n 25 "$(log_file "$svc")" >&2
      return 1
    fi
    code="$(http_code "$url" 20)"
    if [[ "$code" == "200" ]]; then
      say "  $svc sağlıklı ($url, $((SECONDS - started)) sn)."
      return 0
    fi
    sleep 2
  done
  warn "$svc: $limit sn içinde sağlıklı olmadı ($url son kod: ${code:-yok}). Log: $(log_file "$svc")"
  return 1
}

stop_service() {
  local svc="$1" pgid i
  if ! pgid="$(service_pgid "$svc")"; then
    rm -f "$(pid_file "$svc")"
    say "  $svc çalışmıyor."
    return 0
  fi
  kill -TERM -- "-$pgid" 2>/dev/null
  for i in $(seq 1 20); do
    pgrep -g "$pgid" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if pgrep -g "$pgid" >/dev/null 2>&1; then
    kill -KILL -- "-$pgid" 2>/dev/null
    sleep 0.5
  fi
  rm -f "$(pid_file "$svc")"
  say "  $svc durduruldu (pgid $pgid)."
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

targets() {
  if (($# == 0)); then
    printf '%s\n' "${SERVICES[@]}"
    return 0
  fi
  local s
  for s in "$@"; do
    if ! is_service "$s"; then
      warn "bilinmeyen servis: $s (geçerli: ${SERVICES[*]})"
      return 1
    fi
    printf '%s\n' "$s"
  done
}

cmd_up() {
  local list svc started=() failed=0 found
  list="$(targets "$@")" || return 2
  found="$(uygulama_processes)"
  if [[ -n "$found" ]]; then
    warn "$UYGULAMA_DIR worktree'sinden çalışan API/worker süreçleri var; aynı veritabanı ve Redis'te ekosistem işlerini kapar."
    warn "Bu süreçleri sen durdur (bu betik başka oturumların süreçlerini öldürmez), sonra tekrar dene:"
    while IFS=$'\t' read -r pid cwd cmd; do warn "    pid $pid · cwd $cwd · $cmd"; done <<<"$found"
    return 1
  fi
  say "Başlatılıyor…"
  for svc in $list; do
    if start_service "$svc"; then started+=("$svc"); else failed=1; fi
  done
  ((${#started[@]})) || return 1
  say "Sağlık bekleniyor…"
  for svc in "${started[@]}"; do wait_healthy "$svc" || failed=1; done
  return $failed
}

cmd_down() {
  local list svc
  list="$(targets "$@")" || return 2
  for svc in $list; do stop_service "$svc"; done
}

cmd_status() {
  local svc port pgid code pid line found c
  # Header padded by hand: printf widths count bytes, not the Turkish letters.
  say "SERVİS          PORT   DURUM      SAĞLIK   PORTU TUTAN"
  for svc in "${SERVICES[@]}"; do
    port="$(port_of "$svc")"
    if pgid="$(service_pgid "$svc")"; then line="pgid $pgid"; else line="-"; fi
    code="$(http_code "$(health_url "$svc")" 3)"
    pid="$(listeners "$port" | head -n 1)"
    if [[ -z "$pid" ]]; then
      c="boş"
    elif port_is_ours "$svc"; then
      c="yerel.sh"
    else
      c="$(describe_pid "$pid")"
    fi
    printf '%-15s %-6s %-10s %-8s %s\n' "$svc" "$port" "$line" "${code:-000}" "$c"
  done
  say ""
  say "Docker bağımlılıkları:"
  for c in altyapi-postgres-1 altyapi-valkey-1 altyapi-minio-1 supabase_db_udlmhjozkihasspfgzkp supabase_kong_udlmhjozkihasspfgzkp supabase_auth_udlmhjozkihasspfgzkp supabase_rest_udlmhjozkihasspfgzkp; do
    if docker_running "$c"; then say "  ✓ $c"; else say "  ✗ $c"; fi
  done
  say ""
  say "Bekçiler:"
  if karmatik_env_ok 2>/dev/null; then say "  ✓ karmatik .env.development.local yerel"; else say "  ✗ karmatik env (ayrıntı: yerel.sh up karmatik)"; fi
  if yanit_env_ok 2>/dev/null; then say "  ✓ yanit apps/web/.env.local yerel"; else say "  ✗ yanit env (ayrıntı: yerel.sh up yanit)"; fi
  found="$(uygulama_processes)"
  if [[ -n "$found" ]]; then say "  ✗ altyapi-uygulama API/worker çalışıyor (up reddedilir)"; else say "  ✓ altyapi-uygulama API/worker yok"; fi
  if [[ -f "$KIMLIK" ]]; then say "  kimlikler: $KIMLIK ($(grep -c '=' "$KIMLIK") anahtar)"; else say "  kimlikler: $KIMLIK henüz yok"; fi
}

cmd_logs() {
  local svc="${1:-}"
  is_service "$svc" || { warn "kullanım: yerel.sh logs <${SERVICES[*]// /|}> [-f]"; return 2; }
  [[ -f "$(log_file "$svc")" ]] || { warn "$svc için log yok."; return 1; }
  if [[ "${2:-}" == "-f" ]]; then tail -n 100 -F "$(log_file "$svc")"; else tail -n 100 "$(log_file "$svc")"; fi
}

# One scheduled endpoint call: prints status and a short body; 404 means not implemented yet.
call_job() {
  local label="$1" url="$2" header="$3" method="${4:-POST}" out code body
  out="$(mktemp "$STATE/tick.XXXXXX")"
  code="$(curl -s -o "$out" -w '%{http_code}' --max-time 300 -X "$method" -H "$header" -H 'content-type: application/json' --data '{}' "$url" 2>/dev/null || true)"
  if [[ "$code" == "405" && "$method" == "POST" ]]; then
    code="$(curl -s -o "$out" -w '%{http_code}' --max-time 300 -H "$header" "$url" 2>/dev/null || true)"
    method="GET"
  fi
  body="$(tr -d '\n' <"$out" | cut -c1-300)"
  rm -f "$out"
  case "$code" in
    404) say "  – $label: uç henüz yok (404), geçildi." ;;
    2??) say "  ✓ $label [$method $code] $body" ;;
    000 | "") say "  ✗ $label: yanıt yok (zaman aşımı ya da bağlantı hatası)." ;;
    *) say "  ✗ $label [$method $code] $body" ;;
  esac
}

cmd_tick() {
  local secret site
  say "Kârmatik zamanlanmış uçları:"
  if ! port_is_ours karmatik; then
    say "  – karmatik yerel.sh ile başlatılmamış; güvenlik için tetiklenmedi (yerel.sh up karmatik)."
  else
    secret="$(env_value "$KARMATIK_DIR/.env.development.local" CRON_SECRET)"
    if [[ -z "$secret" ]]; then
      say "  ✗ CRON_SECRET .env.development.local içinde yok."
    else
      # Header name from src/lib/cron-auth.server.ts (requireCronAuth reads `apikey`).
      call_job "ekosistem-kar" "http://localhost:3999/api/public/hooks/ekosistem-kar" "apikey: $secret"
      call_job "ekosistem-cek" "http://localhost:3999/api/public/hooks/ekosistem-cek" "apikey: $secret"
      call_job "ekosistem-bakim" "http://localhost:3999/api/public/hooks/ekosistem-bakim" "apikey: $secret"
    fi
  fi
  say "Yanıt zamanlanmış uçları:"
  if ! port_is_ours yanit; then
    say "  – yanit yerel.sh ile başlatılmamış; güvenlik için tetiklenmedi (yerel.sh up yanit)."
  else
    secret="$(env_value "$KIMLIK" YANIT_CRON_SECRET)"
    [[ -n "$secret" ]] || secret="$(env_value "$YANIT_DIR/apps/web/.env.local" CRON_SECRET)"
    if [[ -z "$secret" ]]; then
      say "  ✗ YANIT_CRON_SECRET ($KIMLIK) ya da apps/web/.env.local CRON_SECRET yok."
    else
      site="$(env_value "$YANIT_DIR/apps/web/.env.local" NEXT_PUBLIC_SITE_URL)"
      # daily-run chains itself through NEXT_PUBLIC_SITE_URL (default https://yanit.io).
      if is_local_url "$site"; then
        call_job "daily-run" "http://localhost:3200/api/cron/daily-run" "Authorization: Bearer $secret"
      else
        say "  – daily-run geçildi: apps/web/.env.local NEXT_PUBLIC_SITE_URL yerel değil (zincir tetikleme canlıya gider)."
      fi
      call_job "ekosistem" "http://localhost:3200/api/cron/ekosistem" "Authorization: Bearer $secret"
    fi
  fi
  say "altyapi: worker kendi zamanlayıcısıyla 60 sn'de bir çeker (ekosistem.schedule-pulls); tetiklenecek uç yok."
}

cmd_tohum() {
  local tsx="$ROOT/apps/api/node_modules/.bin/tsx"
  [[ -x "$tsx" ]] || { warn "tsx bulunamadı: $tsx (pnpm install)."; return 1; }
  (cd "$ROOT/apps/api" && node --env-file=../../.env --import tsx "$ROOT/tools/ekosistem/tohum-altyapi.ts" "$@")
}

cmd_test() {
  local f failed=0 ran=0
  say "Uçtan uca testler (iskelet — E2E ajanı dolduracak)."
  for f in "$ROOT"/tools/ekosistem/e2e-*.ts; do
    [[ -f "$f" ]] || continue
    ran=1
    say "▶ $(basename "$f")"
    (cd "$ROOT/apps/api" && node --env-file=../../.env --import tsx "$f") || failed=1
  done
  if [[ -f "$KARMATIK_DIR/scripts/ekosistem-e2e.ts" ]]; then
    if [[ -n "$(listeners 3999)" ]]; then
      say "– Kârmatik scripts/ekosistem-e2e.ts geçildi: kendi Bun sunucusunu 3999'da açar; önce 'yerel.sh down karmatik'."
    else
      say "– Kârmatik scripts/ekosistem-e2e.ts: LOCAL_SUPABASE_JWT_SECRET ve EKOSISTEM_E2E_USER ile elle çalıştır (bkz. yerel-kurulum.md)."
    fi
  fi
  ((ran)) || say "– tools/ekosistem/e2e-*.ts henüz yok."
  return $failed
}

usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
}

main() {
  local cmd="${1:-}"
  (($#)) && shift
  case "$cmd" in
    up) cmd_up "$@" ;;
    down) cmd_down "$@" ;;
    status) cmd_status ;;
    logs) cmd_logs "$@" ;;
    tick) cmd_tick ;;
    tohum) cmd_tohum "$@" ;;
    test) cmd_test ;;
    -h | --help | help | "") usage ;;
    *)
      warn "bilinmeyen komut: $cmd"
      usage
      return 2
      ;;
  esac
}

main "$@"
