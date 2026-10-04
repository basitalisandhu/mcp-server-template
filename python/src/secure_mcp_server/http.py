"""Optional streamable HTTP transport.

Off by default (MCP_TRANSPORT=stdio). When enabled it binds to 127.0.0.1 unless MCP_HOST says
otherwise, validates the Host header, requires a bearer token on every MCP request, rate-limits
per client and caps the request body. Sessions are stateless, so nothing is shared between
clients.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastmcp import FastMCP
from fastmcp.server.middleware.rate_limiting import RateLimitingMiddleware
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .auth import SharedTokenVerifier
from .config import Settings
from .logging import get_logger
from .server import INSTRUCTIONS
from .tools import register_tools

log = get_logger("secure_mcp_server.http")


class BodySizeLimitMiddleware:
    """Pure ASGI middleware: reject requests whose body exceeds ``max_bytes`` with 413."""

    def __init__(self, app: Any, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        declared = headers.get("content-length", "")
        if declared.isdigit() and int(declared) > self.max_bytes:
            await JSONResponse({"error": "payload_too_large"}, status_code=413)(
                scope, receive, send
            )
            return
        received = 0
        too_large = False

        async def limited_receive() -> dict[str, Any]:
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    too_large = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def guarded_send(message: dict[str, Any]) -> None:
            if too_large and message["type"] == "http.response.start":
                message = {**message, "status": 413}
            await send(message)

        await self.app(scope, limited_receive, guarded_send)


def create_http_app(settings: Settings, http_client: httpx.AsyncClient | None = None) -> Any:
    if not settings.auth_token:
        raise ValueError("MCP_AUTH_TOKEN is required for the HTTP transport")
    verifier = SharedTokenVerifier(
        settings.auth_token, base_url=f"http://{settings.host}:{settings.port}"
    )
    per_second = settings.rate_limit_per_minute / 60
    mcp = FastMCP(
        name=settings.server_name,
        version=settings.server_version,
        instructions=INSTRUCTIONS,
        mask_error_details=True,
        auth=verifier,
        middleware=[
            RateLimitingMiddleware(
                max_requests_per_second=per_second,
                burst_capacity=settings.rate_limit_per_minute,
            )
        ],
    )
    register_tools(mcp, settings, http_client)

    @mcp.custom_route("/healthz", methods=["GET"], include_in_schema=False)
    async def healthz(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    allowed_hosts = list(settings.allowed_http_hosts) or [
        f"{settings.host}:*",
        "localhost:*",
        "127.0.0.1:*",
        "[::1]:*",
    ]
    return mcp.http_app(
        path="/mcp",
        stateless_http=True,
        json_response=True,
        middleware=[Middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)],
        host_origin_protection=True,
        allowed_hosts=allowed_hosts,
    )


def serve_http(settings: Settings) -> None:
    import uvicorn

    app = create_http_app(settings)
    log.info(
        "http transport listening",
        extra={
            "host": settings.host,
            "port": settings.port,
            "rate_limit_per_minute": settings.rate_limit_per_minute,
            "max_body_bytes": settings.max_body_bytes,
        },
    )
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")
