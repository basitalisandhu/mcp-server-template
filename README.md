# mcp-server-template: secure MCP server template

Secure MCP server template in TypeScript and Python: a starting point for a Model Context Protocol server that is safe by default. Both reference implementations ship the same four read-only tools and the same controls: strict input validation, file access bounded to allowlisted directories, network access bounded to allowlisted hosts with SSRF protection, structured logs that redact secrets, a health tool, stdio transport by default, and an optional streamable HTTP transport that is bound to 127.0.0.1, requires a bearer token, rate-limits clients and caps request bodies. Tests, Dockerfiles with digest-pinned bases and non-root users, CI with Semgrep, gitleaks and CodeQL, and SBOMs on release are included.

[![CI](https://github.com/basitalisandhu/mcp-server-template/actions/workflows/ci.yml/badge.svg)](https://github.com/basitalisandhu/mcp-server-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Use this template

1. Open the repository on GitHub and press **Use this template**, then **Create a new repository** (the button appears once the repository is marked as a template under Settings, General, "Template repository"). You get a copy with no shared history.
2. Delete the implementation you do not need (`typescript/` or `python/`) and the matching jobs in `.github/workflows/`.
3. Rename the server (`MCP_SERVER_NAME`, `package.json` `name`, `pyproject.toml` `name`), adjust the reporting instructions in `SECURITY.md` if you do not use GitHub's private vulnerability reporting, and keep the threat model section.
4. Add your tools next to the bundled ones following [docs/adding-a-tool.md](docs/adding-a-tool.md). Keep the bundled `health` tool; clients use it to confirm the server is up.
5. Enable Dependabot, secret scanning and code scanning on the new repository. CodeQL in the workflow runs only when the repository is public.

Or clone it:

```bash
git clone https://github.com/basitalisandhu/mcp-server-template my-mcp-server
cd my-mcp-server && rm -rf .git && git init
```

## Why

Most MCP servers are written in an afternoon and then given to an agent that reads untrusted web pages, documents and tool results. Every argument the model sends is attacker-influenced, and a tool that takes a path or a URL is a file-read or SSRF primitive unless it checks its input against a fixed boundary. Servers exposed over HTTP without authentication are reachable by anyone on the network and by browsers through DNS rebinding. Logs that include request headers leak the tokens that protect them. The template makes the safe choice the default for each of these so a new server starts from a known-good position and the controls are tested rather than assumed.

## What is in the box

| | TypeScript (`typescript/`) | Python (`python/`) |
|---|---|---|
| SDK | `@modelcontextprotocol/sdk` 1.x with zod schemas | FastMCP 4.x with pydantic validation |
| Transports | stdio (default); streamable HTTP (opt-in) | stdio (default); streamable HTTP (opt-in) |
| HTTP controls | `requireBearerAuth` with a constant-time shared-token verifier, fixed-window rate limit per client address, body cap, Host header validation (DNS rebinding protection), stateless sessions, loopback bind | `TokenVerifier` with a constant-time shared-token check, FastMCP `RateLimitingMiddleware`, ASGI body cap, Host and Origin protection, stateless sessions, loopback bind |
| Tools | `health`, `read_file`, `list_directory`, `fetch_url` | the same four |
| File boundary | `resolveInside` (realpath, symlink-safe, allowlisted roots, size cap) | `safe_join` (resolve, symlink-safe, allowlisted roots, size cap) |
| Network boundary | `assertSafeUrl` and `fetchBounded` (host allowlist, private ranges blocked, no redirects, size and time caps) | `validate_url` and `fetch_bounded` (same policy) |
| Logging | JSON lines on stderr, `redact` on every field | JSON lines on stderr, `redact` on every field |
| Tests | vitest: 6 files, 33 tests, in-memory client, real HTTP server, local fetch target | pytest: 6 files, 30 tests, in-memory client, uvicorn server, mocked HTTP transport |
| Container | `node:22-alpine` pinned by digest, runs as `node` | `python:3.12-slim` pinned by digest, runs as `mcp` |

## Quickstart

TypeScript:

```bash
cd typescript
npm ci && npm run build && npm test
MCP_ALLOWED_DIRS=$PWD/../docs node dist/index.js        # stdio server exposing one directory
```

Python:

```bash
cd python
uv sync && uv run pytest -q                            # or: pip install -e ".[dev]" && pytest -q
MCP_ALLOWED_DIRS=$PWD/../docs uv run secure-mcp-server # stdio server exposing one directory
```

Client configuration for a stdio server (Claude Desktop, Claude Code, Cursor and others use this shape):

```json
{
  "mcpServers": {
    "secure-mcp-server": {
      "command": "node",
      "args": ["/path/to/typescript/dist/index.js"],
      "env": { "MCP_ALLOWED_DIRS": "/path/to/docs", "MCP_ALLOWED_HOSTS": "docs.example.com" }
    }
  }
}
```

### Try the HTTP transport

```bash
export MCP_TRANSPORT=http
export MCP_AUTH_TOKEN=$(openssl rand -hex 32)        # at least 32 characters or the server refuses to start
export MCP_ALLOWED_DIRS=$PWD/docs
node typescript/dist/index.js                        # or: uv run --project python secure-mcp-server

curl -s http://127.0.0.1:3000/healthz                # {"status":"ok"}, no token needed
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Without the header the endpoint answers 401 with a `WWW-Authenticate: Bearer` challenge; with a Host header that is not loopback it answers 403 (TypeScript) or 421 (Python, from FastMCP's Host protection); with a body over `MCP_MAX_BODY_BYTES` it answers 413; after `MCP_RATE_LIMIT_PER_MINUTE` requests it answers 429. The server binds to `127.0.0.1`; to expose it beyond the host put a TLS reverse proxy in front and keep the bind address on loopback.

## Configuration

Everything is an environment variable; the defaults are the safe ones.

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `MCP_HOST` | `127.0.0.1` | Bind address for the HTTP transport. |
| `MCP_PORT` | `3000` | Port for the HTTP transport. |
| `MCP_AUTH_TOKEN` | unset | Shared bearer token; required for `http`, minimum 32 characters. |
| `MCP_ALLOWED_HTTP_HOSTS` | loopback names | Host header values accepted by the HTTP transport (set when binding beyond loopback behind a proxy). |
| `MCP_ALLOWED_DIRS` | empty (file tools disabled) | Comma-separated directories `read_file` and `list_directory` may read. |
| `MCP_ALLOWED_HOSTS` | empty (fetch disabled) | Comma-separated hosts (`host` or `host:port`) `fetch_url` may contact. |
| `MCP_ALLOW_PRIVATE_NETWORKS` | `false` | Let `fetch_url` reach loopback and private ranges. |
| `MCP_MAX_FILE_BYTES` | `1000000` | Largest file `read_file` returns. |
| `MCP_MAX_RESPONSE_BYTES` | `1000000` | Largest response `fetch_url` keeps (longer bodies are truncated and flagged). |
| `MCP_FETCH_TIMEOUT_MS` | `10000` | Timeout for `fetch_url`. |
| `MCP_MAX_BODY_BYTES` | `1000000` | Request body cap on the HTTP transport. |
| `MCP_RATE_LIMIT_PER_MINUTE` | `120` | Requests per minute per client on the HTTP transport. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`/`warning`, `error`. |
| `MCP_SERVER_NAME`, `MCP_SERVER_VERSION` | `secure-mcp-server`, `0.1.0` | Reported in `initialize` and by `health`. |

## Tools

| Tool | Input | What it refuses |
|---|---|---|
| `health` | none | Nothing; reports name, version, transport, uptime and whether file and network access are enabled. |
| `read_file` | `path` (1 to 4096 characters) | Paths outside `MCP_ALLOWED_DIRS` (including through symlinks), non-files, files over the cap, null bytes. |
| `list_directory` | `path` | Same boundary; returns at most 1000 entries with names and types. |
| `fetch_url` | `url` (http or https, up to 2048 characters) | Hosts not in `MCP_ALLOWED_HOSTS`, non-http schemes, credentials in the URL, private and loopback addresses, redirects (returned as-is, not followed), bodies over the cap, slow responses. |

Descriptions are fixed literals in the source and every tool carries `readOnlyHint: true`; see [docs/adding-a-tool.md](docs/adding-a-tool.md) before adding one that writes.

## Security

[SECURITY.md](SECURITY.md) holds the threat model (tool poisoning via descriptions, path traversal, SSRF, unauthenticated HTTP transport, secret leakage in logs, over-broad tools, resource exhaustion, supply chain), what the template does not cover, and the mapping of each control to the rules in [agentic-semgrep-rules](https://github.com/basitalisandhu/agentic-semgrep-rules), which CI runs against both implementations and which reports no findings on the template.

CI (`.github/workflows/ci.yml`): build and test both implementations, build both images and check they run as non-root, Semgrep with the agentic rule pack, gitleaks, and CodeQL for TypeScript and Python when the repository is public. Release (`.github/workflows/release.yml`, on `v*` tags): images to GHCR with provenance, SPDX SBOMs for each image and each source tree attached to the GitHub release.

## Frequently asked questions

**Why stdio by default?**
A stdio server is reachable only by the process that started it. Most MCP servers are personal tools on one machine, and stdio removes the whole class of network problems (unauthenticated access, DNS rebinding, token handling). Turn on HTTP only when a remote client needs it.

**Can I bind to 0.0.0.0?**
You can set `MCP_HOST`, but the template is designed for a TLS reverse proxy in front of a loopback bind. If you bind beyond loopback, also set `MCP_ALLOWED_HTTP_HOSTS` to the names the proxy forwards, keep the bearer token, and expect the Semgrep rule `fastmcp-bind-all-interfaces` to flag a literal `0.0.0.0` in Python source.

**How is this different from the SDK examples?**
The SDK examples show the protocol. This template adds the boundaries around what the tools can touch, the HTTP hardening, the redacting logger, the tests for the refused cases, the container and CI hardening, and the threat model that explains why each piece exists.

**Does the Python side use the official SDK?**
It uses FastMCP 4, the maintained high-level framework built on the official `mcp` package, because its auth providers, middleware and Host/Origin protection match the controls the template needs. The TypeScript side uses the official `@modelcontextprotocol/sdk` 1.x directly.

## Contributing

Issues and pull requests are welcome; the starter list is in [docs/good-first-issues.md](docs/good-first-issues.md). Changes should land in both implementations; see [CONTRIBUTING.md](CONTRIBUTING.md). Security problems: see [SECURITY.md](SECURITY.md).

## Sibling projects

More tools by the same author: https://github.com/basitalisandhu

- [agentic-semgrep-rules](https://github.com/basitalisandhu/agentic-semgrep-rules): the Semgrep rule pack this template is checked with.
- [agent-config-audit](https://github.com/basitalisandhu/agent-config-audit): audit the agent configuration that launches servers like this one.
- [agent-threat-model](https://github.com/basitalisandhu/agent-threat-model): describe an agent system in YAML, get a STRIDE and OWASP Agentic threat model.
- [agent-security-skills](https://github.com/basitalisandhu/agent-security-skills): Claude Code plugin with an MCP server review skill.
- [ai-agent-incidents](https://github.com/basitalisandhu/ai-agent-incidents): open dataset of publicly documented AI agent security incidents.

## Licence

MIT, see [LICENSE](LICENSE). Copyright 2026 Muhammad Basit Ali. Projects created from the template may use any licence.
