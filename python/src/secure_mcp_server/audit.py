"""One audit log entry per tool call, in one shape a SIEM can parse.

``AuditMiddleware`` wraps every ``tools/call``. After the tool returns it writes a single
``audit`` entry with the tool name, the outcome (``ok``, ``refused`` or ``error``), the duration,
the client id on the HTTP transport and, for successful calls, the resolved target (the real
path, or the host of the URL). Argument values, file contents and response bodies are never part
of the entry; a refused call has no target because the model-supplied value was not accepted.
"""

from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlsplit

from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_access_token
from fastmcp.server.middleware import Middleware

from .logging import get_logger

log = get_logger("secure_mcp_server.audit")


def audit_target(structured: Any) -> str | None:
    """The resolved path, or the URL's host, from a successful result's structured content."""
    if not isinstance(structured, dict):
        return None
    if isinstance(structured.get("path"), str):
        return structured["path"]
    if isinstance(structured.get("url"), str):
        return urlsplit(structured["url"]).netloc or None
    return None


def _client_id() -> str | None:
    try:
        token = get_access_token()
    except Exception:  # no request context (stdio, in-memory)
        return None
    return getattr(token, "client_id", None) if token is not None else None


class AuditMiddleware(Middleware):
    async def on_call_tool(self, context: Any, call_next: Any) -> Any:
        tool = getattr(context.message, "name", None)
        start = time.monotonic()
        outcome, target = "error", None
        try:
            result = await call_next(context)
        except ToolError:
            outcome = "refused"
            raise
        except Exception:
            outcome = "error"
            raise
        else:
            outcome = "ok"
            target = audit_target(getattr(result, "structured_content", None))
            return result
        finally:
            log.info(
                "audit",
                extra={
                    "event": "audit",
                    "tool": tool,
                    "outcome": outcome,
                    "duration_ms": round(1000 * (time.monotonic() - start)),
                    "client_id": _client_id(),
                    "target": target,
                },
            )
