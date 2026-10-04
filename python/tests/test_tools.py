from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from secure_mcp_server.server import build_server

from .conftest import settings_for


async def test_lists_exactly_the_four_read_only_tools():
    async with Client(build_server(settings_for())) as client:
        tools = await client.list_tools()
    assert sorted(t.name for t in tools) == ["fetch_url", "health", "list_directory", "read_file"]
    for t in tools:
        assert t.annotations is not None and t.annotations.read_only_hint is True
        assert t.description and len(t.description) > 20


async def test_health_reports_capabilities(docs_root: Path):
    async with Client(build_server(settings_for(MCP_ALLOWED_DIRS=str(docs_root)))) as client:
        result = await client.call_tool("health", {})
    data = result.data if result.data is not None else result.structured_content
    assert (
        data["status"] == "ok" and data["file_access"] is True and data["network_access"] is False
    )
    assert data["transport"] == "stdio"


async def test_read_file_is_bounded(docs_root: Path):
    mcp = build_server(settings_for(MCP_ALLOWED_DIRS=str(docs_root), MCP_MAX_FILE_BYTES="20"))
    async with Client(mcp) as client:
        ok = await client.call_tool("read_file", {"path": "notes.txt"})
        assert ok.data["content"] == "line one\nline two\n"
        with pytest.raises(ToolError, match="outside the allowed directories"):
            await client.call_tool("read_file", {"path": "../../../etc/passwd"})
        (docs_root / "big.txt").write_text("x" * 21)
        with pytest.raises(ToolError, match="larger than"):
            await client.call_tool("read_file", {"path": "big.txt"})
        with pytest.raises(ToolError, match="not found"):
            await client.call_tool("read_file", {"path": "nope.txt"})
        with pytest.raises(ToolError):
            await client.call_tool("read_file", {"path": "link-out"})


async def test_read_file_disabled_without_roots():
    async with Client(build_server(settings_for())) as client:
        with pytest.raises(ToolError, match="disabled"):
            await client.call_tool("read_file", {"path": "notes.txt"})


async def test_schema_validation_rejects_bad_input(docs_root: Path):
    async with Client(build_server(settings_for(MCP_ALLOWED_DIRS=str(docs_root)))) as client:
        with pytest.raises(ToolError):
            await client.call_tool("read_file", {"path": ""})
        with pytest.raises(ToolError):
            await client.call_tool("read_file", {"nope": 1})


async def test_list_directory(docs_root: Path):
    async with Client(build_server(settings_for(MCP_ALLOWED_DIRS=str(docs_root)))) as client:
        result = await client.call_tool("list_directory", {"path": "."})
        names = {e["name"]: e["type"] for e in result.data["entries"]}
        assert names["notes.txt"] == "file" and names["dir"] == "directory"
        with pytest.raises(ToolError, match="not a directory"):
            await client.call_tool("list_directory", {"path": "notes.txt"})


async def test_fetch_url_disabled_and_policy():
    async with Client(build_server(settings_for())) as client:
        with pytest.raises(ToolError, match="disabled"):
            await client.call_tool("fetch_url", {"url": "https://docs.example.com/"})

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"body text", headers={"content-type": "text/plain"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        mcp = build_server(settings_for(MCP_ALLOWED_HOSTS="docs.example.com"), http_client)
        async with Client(mcp) as client:
            ok = await client.call_tool("fetch_url", {"url": "https://docs.example.com/page"})
            assert ok.data["body"] == "body text" and ok.data["status"] == 200
            with pytest.raises(ToolError, match="allowlist"):
                await client.call_tool("fetch_url", {"url": "https://evil.example.com/"})
            with pytest.raises(ToolError):
                await client.call_tool("fetch_url", {"url": "http://169.254.169.254/latest"})
