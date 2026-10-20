# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Structured audit log: every tool call writes exactly one `audit` entry with `tool`, `outcome` (`ok`, `refused`, `error`), `duration_ms`, `client_id` (the bearer client on the HTTP transport) and the resolved `target` (real path, or host for `fetch_url`), never argument values or content. One wrapper in TypeScript (`src/audit.ts`), one FastMCP middleware in Python (`audit.py`), with tests for allowed, refused and failed calls and for the client id over HTTP (#13).

### Fixed

- TypeScript `resolveInside` refused an absolute path spelt through the configured root when that root is reached through a symlink (for example `MCP_ALLOWED_DIRS=/tmp/docs` on macOS, where `/tmp` points to `/private/tmp`), so `read_file` and `list_directory` denied files that were inside the allowed directory. It now compares real paths only, as the Python implementation already did; both have a test for the case.
- Python: the dev dependencies move from the deprecated `tool.uv.dev-dependencies` to `[dependency-groups]`, so `uv sync` no longer prints a deprecation warning.
- README and the Python Dockerfile comment named `python:3.12-slim`; the image has been `python:3.14-slim` since 0.2.1.

## [0.2.1] - 2026-10-18

### Changed

- Dependency updates: the MCP SDK, the Python base image (3.14-slim) and the GitHub Actions group.
- Harden the workflows and repository policy for the OpenSSF Scorecard (#29).

## [0.2.0] - 2026-10-09

### Added

- `scripts/gen_env_table.py` generates the README configuration table from both implementations, and a CI step (`--check`) fails when the table is stale or a new variable lacks a description.

### Changed

- TypeScript implementation: TypeScript 7 and Vitest 5; `@types/node` stays on the Node 22 line (`^22.20.5`) and Dependabot ignores its major bumps.

## [0.1.1] - 2026-10-06

### Changed

- Removed the umbrella branding; this project stands alone and links its sibling repositories directly.

## [0.1.0] - 2026-10-03

### Added

- TypeScript reference implementation on `@modelcontextprotocol/sdk` and zod: stdio by default, optional streamable HTTP with bearer auth, per-client rate limit, request body cap, Host header validation, bound to 127.0.0.1.
- Python reference implementation on FastMCP with the same controls.
- Four read-only tools in each (`health`, `read_file`, `list_directory`, `fetch_url`) with fixed descriptions, strict input schemas, allowlisted directories and hosts, size and time caps, no redirects and private-network blocking.
- Structured JSON logging on stderr with secret redaction.
- Tests for both implementations, Dockerfiles with digest-pinned bases and non-root users, CI with build, test, Semgrep (agentic-semgrep-rules), gitleaks and CodeQL gated on public visibility, release workflow with SBOMs.
- SECURITY.md with the threat model and the mapping to agentic-semgrep-rules.

[Unreleased]: https://github.com/basitalisandhu/mcp-server-template/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/basitalisandhu/mcp-server-template/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/basitalisandhu/mcp-server-template/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/basitalisandhu/mcp-server-template/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/basitalisandhu/mcp-server-template/releases/tag/v0.1.0
