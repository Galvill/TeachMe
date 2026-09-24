#!/usr/bin/env bash
# Integration gate for TeachMe: the stand-in for MCPGW's e2e stack.
#
# Run from the root of a clean checkout of the branch under test (e.g. a
# throwaway worktree of the integration branch). It exercises the product the
# way a user gets it: a fresh `npm ci`, the full unit suite, then the packed
# tarball installed into a temp prefix, its CLI subcommands, and a live server
# probed over HTTP. Nothing here binds a fixed port or touches ~/.TeachMe, so
# any number of gates can run side by side.
#
# Output: one receipt line per step, `<epoch-start> <seconds> <exit> <step>`,
# then `RESULT PASS` or `RESULT FAIL`. Exit status 0 only on PASS. A failing
# step's last 30 log lines go to stderr; full logs stay in the printed work dir.
#
# Browser rendering (Mermaid, Shiki, quiz flow) is NOT covered here; the
# orchestrator runs that as a separate Playwright smoke. See
# .claude/commands/process-issues.md, Phase 7.

set -uo pipefail

root=$(pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/teachme-gate-XXXXXX")
export TEACHME_HOME="$work/home"
fail=0
server_pid=""

cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null; fi
}
trap cleanup EXIT

# step <name> <command...>: run, time and record one gate step.
step() {
  local name=$1
  shift
  local log="$work/$(echo "$name" | tr -c 'a-zA-Z0-9\n' '-').log"
  local t0 ec
  t0=$(date +%s)
  "$@" >"$log" 2>&1
  ec=$?
  printf '%s %s %s %s\n' "$t0" "$(($(date +%s) - t0))" "$ec" "$name"
  if [ "$ec" -ne 0 ]; then
    fail=1
    echo "--- $name failed; tail of $log:" >&2
    tail -30 "$log" >&2
  fi
  return "$ec"
}

# expect_http <path> <status> [grep-pattern]: GET against the live server.
expect_http() {
  local body="$work/body" code
  code=$(curl -s -o "$body" -w '%{http_code}' --path-as-is "$url$1")
  [ "$code" = "$2" ] || { echo "GET $1: want $2, got $code"; cat "$body"; return 1; }
  if [ -n "${3:-}" ]; then grep -q -- "$3" "$body" || { echo "GET $1: body lacks '$3'"; return 1; }; fi
}

# traversal_refused: no /content/* escape may return the repo's package.json.
# Dot-segment forms get normalized by the URL parser and fall through to the
# SPA index.html (200), so assert on the body, not the status code.
traversal_refused() {
  local p code
  for p in /content/../package.json /content/%2e%2e/package.json /content/..%2fpackage.json \
    /content/..%2f..%2fpackage.json; do
    code=$(curl -s -o "$work/body" -w '%{http_code}' --path-as-is "$url$p")
    if grep -q '"devDependencies"' "$work/body"; then echo "GET $p leaked package.json ($code)"; return 1; fi
  done
}

progress_roundtrip() {
  local payload='{"courses":{"how-teachme-works":{"visited":["01-overview"]}},"quizzes":{}}'
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
    --data "$payload" "$url/api/progress")
  case "$code" in 2*) ;; *) echo "PUT /api/progress: got $code"; return 1 ;; esac
  expect_http /api/progress 200 '01-overview' || return 1
  grep -q '01-overview' "$TEACHME_HOME/progress.json" || { echo "progress.json not written under TEACHME_HOME"; return 1; }
}

start_server() {
  "$bin" "$root/.teachme" --no-open --port 0 >"$work/server.out" 2>&1 &
  server_pid=$!
  for _ in $(seq 50); do
    url=$(grep -o 'http://127\.0\.0\.1:[0-9]*' "$work/server.out" | head -1)
    [ -n "$url" ] && return 0
    kill -0 "$server_pid" 2>/dev/null || break
    sleep 0.2
  done
  cat "$work/server.out"
  return 1
}

echo "gate work dir: $work"

step "npm ci" npm ci --no-audit --no-fund
step "npm test" npm test
step "npm run typecheck" npm run typecheck
step "npm run build" npm run build

# Pack and install exactly what `npm publish` would ship, so a module missing
# from package.json "files" or an unbuilt dist/ fails here, not for a user.
step "npm pack" npm pack --pack-destination "$work"
tarball=$(ls "$work"/teachme-*.tgz 2>/dev/null | head -1)
step "install tarball" npm install --no-audit --no-fund --prefix "$work/inst" "$tarball"
bin="$work/inst/node_modules/.bin/teachme"

step "cli --help" "$bin" --help
step "cli validate example" "$bin" validate "$work/inst/node_modules/teachme/skill/teachme-authoring/examples/.teachme"
step "cli validate dogfood" "$bin" validate "$root/.teachme"
step "cli status dogfood" "$bin" status "$root/.teachme" --json
cp "$work/cli-status-dogfood.log" "$work/status.json" 2>/dev/null

if step "serve start" start_server; then
  step "GET / serves UI" expect_http / 200 'id="root"'
  step "GET /api/catalog" expect_http /api/catalog 200 '"how-teachme-works"'
  step "GET /api/courses/:slug" expect_http /api/courses/how-teachme-works 200
  step "GET /content file" expect_http /content/courses/how-teachme-works/course.md 200
  step "GET /api unknown is 404" expect_http /api/nope 404
  step "GET /content traversal refused" traversal_refused
  step "progress roundtrip" progress_roundtrip
  step "server still alive" kill -0 "$server_pid"
fi

# Informational only: Phase 7 part (d) decides what a non-ok item means.
if grep -Eq '"state": "(stale|never-synced|unknown-commit)"' "$work/status.json" 2>/dev/null; then
  echo "NOTE dogfood content has items not in state ok; see $work/status.json"
fi

if [ "$fail" -eq 0 ]; then echo "RESULT PASS"; else echo "RESULT FAIL"; fi
exit "$fail"
