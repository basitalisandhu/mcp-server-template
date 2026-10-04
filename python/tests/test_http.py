from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
import uvicorn
from fastmcp import Client

from secure_mcp_server.auth import SharedTokenVerifier
from secure_mcp_server.http import create_http_app

from .conftest import TEST_TOKEN, settings_for

INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "t", "version": "0"},
    },
}
HEADERS = {"content-type": "application/json", "accept": "application/json, text/event-stream"}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(**env: str) -> Iterator[str]:
    port = _free_port()
    settings = settings_for(
        MCP_TRANSPORT="http", MCP_AUTH_TOKEN=TEST_TOKEN, MCP_PORT=str(port), **env
    )
    app = create_http_app(settings)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            if httpx.get(f"{base}/healthz", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    else:
        raise RuntimeError("server did not start")
    yield base
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="module")
def base(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    root: Path = tmp_path_factory.mktemp("root")
    (root / "notes.txt").write_text("hello", encoding="utf-8")
    yield from _serve(
        MCP_RATE_LIMIT_PER_MINUTE="600", MCP_MAX_BODY_BYTES="2048", MCP_ALLOWED_DIRS=str(root)
    )


@pytest.fixture(scope="module")
def limited_base() -> Iterator[str]:
    yield from _serve(MCP_RATE_LIMIT_PER_MINUTE="3")


def test_health_endpoint_is_unauthenticated(base: str):
    r = httpx.get(f"{base}/healthz")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_missing_or_wrong_token_is_rejected(base: str):
    none = httpx.post(f"{base}/mcp", json=INIT, headers=HEADERS)
    assert none.status_code == 401
    assert "bearer" in none.headers.get("www-authenticate", "").lower()
    wrong = httpx.post(
        f"{base}/mcp", json=INIT, headers={**HEADERS, "authorization": "Bearer " + "x" * 48}
    )
    assert wrong.status_code == 401
    basic = httpx.post(f"{base}/mcp", json=INIT, headers={**HEADERS, "authorization": "Basic abc"})
    assert basic.status_code == 401


def test_foreign_host_header_is_rejected(base: str):
    r = httpx.post(
        f"{base}/mcp",
        json=INIT,
        headers={**HEADERS, "host": "evil.example.com", "authorization": f"Bearer {TEST_TOKEN}"},
    )
    assert r.status_code in {400, 403, 421}


def test_oversized_body_is_rejected(base: str):
    big = {**INIT, "params": {**INIT["params"], "pad": "x" * 3000}}
    r = httpx.post(
        f"{base}/mcp", json=big, headers={**HEADERS, "authorization": f"Bearer {TEST_TOKEN}"}
    )
    assert r.status_code == 413


async def test_full_session_with_the_right_token(base: str):
    async with Client(f"{base}/mcp", auth=TEST_TOKEN) as client:
        tools = await client.list_tools()
        assert "health" in {t.name for t in tools}
        health = await client.call_tool("health", {})
        assert health.data["transport"] == "http"
        notes = await client.call_tool("read_file", {"path": "notes.txt"})
        assert notes.data["content"] == "hello"


async def test_rate_limit_is_enforced(limited_base: str):
    errors: list[str] = []
    async with Client(f"{limited_base}/mcp", auth=TEST_TOKEN) as client:
        for _ in range(10):
            try:
                await client.call_tool("health", {})
            except Exception as exc:
                errors.append(str(exc))
                break
    assert errors and "rate limit" in errors[0].lower()


async def test_verifier_accepts_only_the_exact_token():
    v = SharedTokenVerifier(TEST_TOKEN)
    info = await v.verify_token(TEST_TOKEN)
    assert info is not None and info.client_id == "shared-token" and info.token != TEST_TOKEN
    assert await v.verify_token(TEST_TOKEN + "x") is None
    assert await v.verify_token("") is None
