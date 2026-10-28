#!/usr/bin/env bash
# Run the README Quickstart on a fresh clone, for whichever implementations are present.
#
# TypeScript: npm ci, build, test, then the stdio server with MCP_ALLOWED_DIRS=docs is driven
# by a small MCP client (tools listed, docs read, ../ refused, metadata URL refused), then
# "Try the HTTP transport": /healthz, 401 without the token, 200 for initialize with it.
# Python: uv sync, pytest, and the same stdio checks against `uv run secure-mcp-server`.
#
#   scripts/e2e-quickstart.sh
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
pid=""
cleanup() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

git clone --quiet "$repo" "$work/clone"
cd "$work/clone"
docs="$PWD/docs"
sdk="$PWD/typescript/node_modules/@modelcontextprotocol/sdk"

if [ -d typescript ]; then
  echo "== TypeScript"
  (cd typescript && npm ci --no-audit --no-fund --silent && npm run --silent build && npm test --silent >/dev/null)
  node scripts/e2e-client.mjs "$sdk" "$docs" node typescript/dist/index.js

  echo "== TypeScript, HTTP transport"
  token="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  MCP_TRANSPORT=http MCP_AUTH_TOKEN="$token" MCP_ALLOWED_DIRS="$docs" MCP_PORT=3917 node typescript/dist/index.js 2>"$work/http.log" &
  pid=$!
  for _ in $(seq 1 50); do curl -fs http://127.0.0.1:3917/healthz >/dev/null 2>&1 && break; sleep 0.1; done
  test "$(curl -s http://127.0.0.1:3917/healthz)" = '{"status":"ok"}'
  init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3917/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$init")"
  test "$code" = 401 || { echo "FAIL: expected 401 without the token, got $code" >&2; exit 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3917/mcp -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$init")"
  test "$code" = 200 || { echo "FAIL: expected 200 with the token, got $code" >&2; cat "$work/http.log" >&2; exit 1; }
  kill "$pid"
  wait "$pid" 2>/dev/null || true
  pid=""
  echo "HTTP: healthz, 401 without the token, 200 with it"
fi

if [ -d python ] && command -v uv >/dev/null; then
  echo "== Python"
  (cd python && uv sync --quiet && uv run --quiet pytest -q >/dev/null)
  if [ -d "$sdk" ]; then
    node scripts/e2e-client.mjs "$sdk" "$docs" uv run --quiet --project python secure-mcp-server
  fi
fi

echo "quick start OK on a fresh clone"
