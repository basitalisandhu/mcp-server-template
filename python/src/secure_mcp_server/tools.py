"""Tool registrations.

Every tool has a fixed, reviewed description (the model reads it, so it is part of the attack
surface), validated input, read-only annotations and structured output. Model-supplied values
never reach the file system or the network without passing the safety helpers.
"""

from __future__ import annotations

import time
from typing import Annotated, Any

import httpx
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from .config import Settings
from .logging import get_logger
from .safety.network import NetworkPolicy, UrlDenied, fetch_bounded, validate_url
from .safety.paths import PathDenied, read_bounded, safe_join

READ_ONLY = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}
_started = time.monotonic()
log = get_logger("secure_mcp_server.tools")


def register_tools(
    mcp: FastMCP, settings: Settings, http_client: httpx.AsyncClient | None = None
) -> None:
    policy = NetworkPolicy(
        allowed_hosts=settings.allowed_hosts,
        allow_private_networks=settings.allow_private_networks,
        max_response_bytes=settings.max_response_bytes,
        timeout_seconds=settings.fetch_timeout_seconds,
    )

    @mcp.tool(
        name="health",
        description=(
            "Report the server's name, version, transport, uptime and which optional "
            "capabilities are enabled. Takes no input and changes nothing."
        ),
        annotations=READ_ONLY,
    )
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "name": settings.server_name,
            "version": settings.server_version,
            "transport": settings.transport,
            "uptime_seconds": int(time.monotonic() - _started),
            "file_access": bool(settings.allowed_dirs),
            "network_access": bool(settings.allowed_hosts),
        }

    @mcp.tool(
        name="read_file",
        description=(
            "Read a UTF-8 text file from one of the directories this server was configured to "
            "expose (MCP_ALLOWED_DIRS). Paths are resolved inside those directories; symlinks that "
            "point outside are refused; files larger than the configured cap are refused."
        ),
        annotations=READ_ONLY,
    )
    def read_file(
        path: Annotated[
            str,
            Field(
                min_length=1,
                max_length=4096,
                description="File path, relative to an allowed directory or absolute inside one",
            ),
        ],
    ) -> dict[str, Any]:
        try:
            resolved = safe_join(settings.allowed_dirs, path)
            content = read_bounded(resolved, settings.max_file_bytes)
        except PathDenied as exc:
            log.warning("read_file refused", extra={"path": path, "reason": str(exc)})
            raise ToolError(str(exc)) from exc
        except FileNotFoundError as exc:
            raise ToolError("not found") from exc
        log.info("read_file", extra={"path": str(resolved), "bytes": len(content)})
        return {"path": str(resolved), "bytes": len(content.encode()), "content": content}

    @mcp.tool(
        name="list_directory",
        description=(
            "List the entries of a directory inside one of the allowed directories "
            "(MCP_ALLOWED_DIRS). Returns names and types only; never follows symlinks outside "
            "the allowed roots."
        ),
        annotations=READ_ONLY,
    )
    def list_directory(
        path: Annotated[
            str,
            Field(
                min_length=1,
                max_length=4096,
                description="Directory path inside an allowed directory",
            ),
        ],
    ) -> dict[str, Any]:
        try:
            resolved = safe_join(settings.allowed_dirs, path)
            if not resolved.is_dir():
                raise ToolError("not a directory")
            entries = sorted(resolved.iterdir(), key=lambda p: p.name)[:1000]
        except PathDenied as exc:
            log.warning("list_directory refused", extra={"path": path, "reason": str(exc)})
            raise ToolError(str(exc)) from exc
        except FileNotFoundError as exc:
            raise ToolError("not found") from exc
        return {
            "path": str(resolved),
            "entries": [
                {
                    "name": p.name,
                    "type": "file" if p.is_file() else "directory" if p.is_dir() else "other",
                }
                for p in entries
            ],
        }

    @mcp.tool(
        name="fetch_url",
        description=(
            "GET an http(s) URL whose host is on this server's allowlist (MCP_ALLOWED_HOSTS) and "
            "return the body as text. Private and loopback addresses are blocked, redirects are "
            "not followed, and the response is capped in size and time."
        ),
        annotations={**READ_ONLY, "openWorldHint": True},
    )
    async def fetch_url(
        url: Annotated[
            str,
            Field(max_length=2048, description="Absolute http or https URL on an allowlisted host"),
        ],
    ) -> dict[str, Any]:
        try:
            parts = validate_url(url, policy)
            result = await fetch_bounded(parts.geturl(), policy, http_client)
        except UrlDenied as exc:
            log.warning("fetch_url refused", extra={"url": url, "reason": str(exc)})
            raise ToolError(str(exc)) from exc
        log.info(
            "fetch_url",
            extra={"host": parts.hostname, "status": result.status, "bytes": len(result.body)},
        )
        return {
            "url": parts.geturl(),
            "status": result.status,
            "content_type": result.content_type,
            "truncated": result.truncated,
            "body": result.body,
        }
