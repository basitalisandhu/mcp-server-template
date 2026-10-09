"""Generate the README configuration table from both implementations.

Run without arguments to update the marker-delimited table, or with --check to
fail without writing when documentation is stale. Standard library only.
"""

from __future__ import annotations

import argparse
import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = "<!-- env-table:start -->"
END = "<!-- env-table:end -->"
MEANINGS = {
    "MCP_TRANSPORT": "`stdio` or `http`.",
    "MCP_HOST": "Bind address for the HTTP transport.",
    "MCP_PORT": "Port for the HTTP transport.",
    "MCP_AUTH_TOKEN": "Shared bearer token; required for `http`, minimum 32 characters.",
    "MCP_ALLOWED_HTTP_HOSTS": "Host header allowlist; empty uses loopback names.",
    "MCP_ALLOWED_DIRS": "Comma-separated directories `read_file` and `list_directory` may read; empty disables file tools.",
    "MCP_ALLOWED_HOSTS": "Comma-separated hosts (`host` or `host:port`) `fetch_url` may contact; empty disables fetch.",
    "MCP_ALLOW_PRIVATE_NETWORKS": "Let `fetch_url` reach loopback and private ranges.",
    "MCP_MAX_FILE_BYTES": "Largest file `read_file` returns.",
    "MCP_MAX_RESPONSE_BYTES": "Largest response `fetch_url` keeps (longer bodies are truncated and flagged).",
    "MCP_FETCH_TIMEOUT_MS": "Timeout for `fetch_url`, in milliseconds.",
    "MCP_MAX_BODY_BYTES": "Request body cap on the HTTP transport.",
    "MCP_RATE_LIMIT_PER_MINUTE": "Requests per minute per client on the HTTP transport.",
    "LOG_LEVEL": "`debug`, `info`, `warn`/`warning`, `error`.",
    "MCP_SERVER_NAME": "Server name reported in `initialize` and by `health`.",
    "MCP_SERVER_VERSION": "Server version reported in `initialize` and by `health`.",
}


def python_names(source: str) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        args = node.args
        if isinstance(node.func, ast.Attribute) and isinstance(
            node.func.value, ast.Name
        ):
            if node.func.value.id == "env" and node.func.attr == "get" and args:
                key = args[0]
            else:
                continue
        elif isinstance(node.func, ast.Name) and node.func.id in {
            "_int",
            "_list",
            "_bool",
        }:
            if len(args) < 2:
                continue
            key = args[1]
        else:
            continue
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            names.add(key.value)
    return names


def typescript_defaults(source: str) -> dict[str, str]:
    defaults = {}
    for match in re.finditer(
        r'env\["([A-Z_]+)"\](?:\s*\?\?\s*("[^"]*"|true|false|[\d_]+))?', source
    ):
        key, default = match.groups()
        defaults[key] = f"`{default.strip(chr(34))}`" if default else "unset"
    for match in re.finditer(
        r'(intFrom|boolFrom|listFrom)\(env,\s*"([A-Z_]+)"(?:,\s*("[^"]*"|true|false|[\d_]+))?',
        source,
    ):
        helper, key, default = match.groups()
        defaults[key] = (
            "empty"
            if helper == "listFrom"
            else f"`{default.replace('_', '').strip(chr(34))}`"
        )
    return defaults


def table(root: Path = ROOT) -> str:
    ts = typescript_defaults(
        (root / "typescript/src/config.ts").read_text(encoding="utf-8")
    )
    py = python_names(
        (root / "python/src/secure_mcp_server/config.py").read_text(encoding="utf-8")
    )
    if set(ts) != py:
        raise ValueError(
            f"environment variables differ: TypeScript only {sorted(set(ts) - py)}; Python only {sorted(py - set(ts))}"
        )
    missing = set(ts) - MEANINGS.keys()
    if missing:
        raise ValueError(
            f"missing meanings for environment variables: {sorted(missing)}"
        )
    lines = ["| Variable | Default | Meaning |", "|---|---|---|"]
    for key, default in sorted(ts.items()):
        lines.append(f"| `{key}` | {default} | {MEANINGS[key]} |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    readme = ROOT / "README.md"
    text = readme.read_text(encoding="utf-8")
    try:
        generated = table()
        if (
            text.count(START) != 1
            or text.count(END) != 1
            or text.index(START) > text.index(END)
        ):
            raise ValueError(
                "README must contain one ordered pair of environment-table markers"
            )
        before, rest = text.split(START)
        _, after = rest.split(END)
        updated = before + START + "\n\n" + generated + "\n\n" + END + after
    except ValueError as error:
        parser.error(str(error))
    if args.check:
        if updated != text:
            print("Configuration table is stale; run python scripts/gen_env_table.py")
            return 1
        return 0
    readme.write_text(updated, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
