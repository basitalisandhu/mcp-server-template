# Good first issues

Issues the maintainer intends to open under the `good first issue` label, written out so they
can be filed in one sitting. Each is self-contained and has acceptance criteria that CI can verify.
Read [CONTRIBUTING.md](../CONTRIBUTING.md) first: both implementations must stay in step, Semgrep
must stay clean, and every tool change needs a test for the refused case.

## 1. Add a `search_files` tool to both implementations

**Context.** `read_file` and `list_directory` cover reading; agents also need to find a file by
name without listing every directory.

**Acceptance criteria.**

- `search_files(pattern, max_results)` returns paths under the allowed directories whose name
  matches a glob (`*.md`, `README*`). `pattern` is bounded (64 characters, no path separators),
  `max_results` is 1 to 200, results are sorted and never leave the allowed roots (symlinked
  directories are not followed).
- Read-only annotations, fixed description, structured output in both implementations.
- Tests: match inside the root, no match, pattern with `..` or `/` rejected, symlinked directory
  not traversed.
- `README.md` tool table and `SECURITY.md` updated.

## 2. JWT token verifier as an alternative to the shared token

**Context.** The shared bearer token is right for one operator and one client. Multi-tenant
deployments issue JWTs.

**Acceptance criteria.**

- `MCP_AUTH_MODE=jwt` with `MCP_JWT_JWKS_URL`, `MCP_JWT_ISSUER` and `MCP_JWT_AUDIENCE` selects a
  verifier that validates signature, issuer, audience and expiry (the TypeScript SDK ships `jose`
  as a dependency; FastMCP ships `JWTVerifier`).
- The shared-token mode stays the default and the behaviour of every existing test is unchanged.
- Tests sign a token with a test key and cover valid, expired and wrong-audience tokens offline.
- `SECURITY.md` "What it does not protect against" loses the OAuth bullet and gains a description
  of the JWT mode.

## 3. Structured audit log of every tool call

**Context.** The logger records refusals and successes per tool, but not in one consistent shape
that a SIEM can parse.

**Acceptance criteria.**

- Every tool call emits exactly one `audit` log entry with `tool`, `outcome` (`ok`, `refused`,
  `error`), `duration_ms`, the client id on the HTTP transport, and the resolved target (path or
  host) without the content.
- Implemented once per implementation (a wrapper around tool handlers in TypeScript, a FastMCP
  middleware in Python) rather than inside each tool.
- Tests assert the entry for an allowed and a refused call and that no argument content appears in it.

## 4. Issue and pull request templates for projects created from the template

**Context.** A repository created with "Use this template" inherits `.github/` but has no issue
forms.

**Acceptance criteria.**

- `.github/ISSUE_TEMPLATE/bug.yml` (implementation, transport, redacted config, steps),
  `.github/ISSUE_TEMPLATE/tool-proposal.yml` (name, what it reads or changes, what it must refuse,
  annotations), `.github/ISSUE_TEMPLATE/config.yml` pointing vulnerabilities at SECURITY.md.
- `.github/PULL_REQUEST_TEMPLATE.md` with the CONTRIBUTING checklist.
- All parse as YAML.

## 5. A `make demo` that runs the HTTP transport locally with a generated token

**Context.** Trying the HTTP transport takes four environment variables and a generated token; a
one-command demo lowers the bar.

**Acceptance criteria.**

- `Makefile` targets `demo-ts` and `demo-py` that generate a token with `openssl rand -hex 32`,
  export the variables, start the server on a free port and print a ready-to-paste client
  configuration (and the `curl` for `/healthz`).
- The token is printed once, never written to a file, and the targets refuse to run with
  `MCP_HOST` set to anything other than loopback.
- README "Try the HTTP transport" section uses the targets.

## 6. Document the environment variables in one generated table

**Context.** `config.ts` and `config.py` define the same variables; the README table is kept by
hand.

**Acceptance criteria.**

- `scripts/gen_env_table.py` reads both config modules (regular expressions over the source are
  acceptable) and renders the "Configuration" table in `README.md` between marker comments, with a
  `--check` flag that exits 1 when the table is stale.
- CI runs the check; a test asserts both implementations define the same variable names.
