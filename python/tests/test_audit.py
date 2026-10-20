from __future__ import annotations

import io
import json
from pathlib import Path

import httpx
import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from secure_mcp_server.audit import audit_target
from secure_mcp_server.logging import configure_logging
from secure_mcp_server.server import build_server

from .conftest import settings_for


@pytest.fixture
def audit_stream():
    stream = io.StringIO()
    configure_logging("info", stream)
    yield stream
    configure_logging("info")


def entries(stream: io.StringIO) -> list[dict]:
    lines = [json.loads(line) for line in stream.getvalue().splitlines() if line]
    return [e for e in lines if e.get("event") == "audit"]


async def test_one_entry_per_call_with_the_resolved_target_and_no_content(
    docs_root: Path, audit_stream
):
    mcp = build_server(settings_for(MCP_ALLOWED_DIRS=str(docs_root)))
    async with Client(mcp) as client:
        await client.call_tool("read_file", {"path": "notes.txt"})
    [entry] = entries(audit_stream)
    assert entry["tool"] == "read_file" and entry["outcome"] == "ok"
    assert entry["target"] == str((docs_root / "notes.txt").resolve())
    assert isinstance(entry["duration_ms"], int) and entry["client_id"] is None
    assert "line one" not in json.dumps(entry)


async def test_refusal_has_no_target_and_no_argument(docs_root: Path, audit_stream):
    mcp = build_server(settings_for(MCP_ALLOWED_DIRS=str(docs_root)))
    async with Client(mcp) as client:
        with pytest.raises(ToolError):
            await client.call_tool("read_file", {"path": "../../../etc/passwd"})
    [entry] = entries(audit_stream)
    assert entry["outcome"] == "refused" and entry["target"] is None
    assert "passwd" not in json.dumps(entry)


async def test_fetch_records_the_host_only(audit_stream):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="response body", headers={"content-type": "text/plain"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        mcp = build_server(settings_for(MCP_ALLOWED_HOSTS="docs.example.com"), http)
        async with Client(mcp) as client:
            await client.call_tool("fetch_url", {"url": "https://docs.example.com/p?q=private"})
            await client.call_tool("health", {})
    got = entries(audit_stream)
    assert [(e["tool"], e["outcome"], e["target"]) for e in got] == [
        ("fetch_url", "ok", "docs.example.com"),
        ("health", "ok", None),
    ]
    assert "private" not in json.dumps(got) and "response body" not in json.dumps(got)


def test_audit_target_shapes():
    assert audit_target({"path": "/x"}) == "/x"
    assert audit_target({"url": "https://h.example:8443/a"}) == "h.example:8443"
    assert audit_target({"status": "ok"}) is None
    assert audit_target(None) is None
