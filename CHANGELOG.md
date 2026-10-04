# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-03

### Added

- TypeScript reference implementation on `@modelcontextprotocol/sdk` and zod: stdio by default, optional streamable HTTP with bearer auth, per-client rate limit, request body cap, Host header validation, bound to 127.0.0.1.
- Python reference implementation on FastMCP with the same controls.
- Four read-only tools in each (`health`, `read_file`, `list_directory`, `fetch_url`) with fixed descriptions, strict input schemas, allowlisted directories and hosts, size and time caps, no redirects and private-network blocking.
- Structured JSON logging on stderr with secret redaction.
- Tests for both implementations, Dockerfiles with digest-pinned bases and non-root users, CI with build, test, Semgrep (agentic-semgrep-rules), gitleaks and CodeQL gated on public visibility, release workflow with SBOMs.
- SECURITY.md with the threat model and the mapping to agentic-semgrep-rules.

[Unreleased]: https://github.com/basitalisandhu/mcp-server-template/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/basitalisandhu/mcp-server-template/releases/tag/v0.1.0
