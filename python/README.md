# secure-mcp-server (Python)

Python reference implementation of the [secure MCP server template](../README.md), built on FastMCP. See the repository README for the quickstart, the controls and the threat model; this file covers what is specific to the Python side.

```bash
cd python
uv sync                       # or: python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
uv run secure-mcp-server      # stdio transport
uv run pytest -q
```

Layout: `src/secure_mcp_server/config.py` (settings from the environment), `logging.py` (JSON lines on stderr with redaction), `safety/paths.py` (`safe_join`, `read_bounded`), `safety/network.py` (`validate_url`, `fetch_bounded`), `tools.py` (the four tools), `auth.py` (shared bearer token verifier), `http.py` (streamable HTTP app with auth, rate limit, body cap and Host validation), `server.py` and `__main__.py`.
