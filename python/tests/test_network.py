from __future__ import annotations

import httpx
import pytest

from secure_mcp_server.safety.network import (
    NetworkPolicy,
    UrlDenied,
    fetch_bounded,
    is_private_address,
    validate_url,
)


def policy(**over):
    base = {
        "allowed_hosts": ("docs.example.com", "api.example.com:8443"),
        "allow_private_networks": False,
        "max_response_bytes": 1000,
        "timeout_seconds": 2.0,
    }
    base.update(over)
    return NetworkPolicy(**base)


def test_private_address_classification():
    for h in [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "::1",
        "fe80::1",
        "fd00::1",
        "localhost",
        "foo.localhost",
        "db.internal",
    ]:
        assert is_private_address(h), h
    for h in ["8.8.8.8", "172.32.0.1", "93.184.216.34", "docs.example.com", "2606:4700::1111"]:
        assert not is_private_address(h), h


def test_validate_url_allowlist_and_schemes():
    assert validate_url("https://docs.example.com/page", policy()).hostname == "docs.example.com"
    assert validate_url("https://api.example.com:8443/v1", policy()).port == 8443
    with pytest.raises(UrlDenied, match="allowlist"):
        validate_url("https://api.example.com/v1", policy())
    with pytest.raises(UrlDenied, match="scheme"):
        validate_url("ftp://docs.example.com/", policy())
    with pytest.raises(UrlDenied, match="scheme"):
        validate_url("file:///etc/passwd", policy())
    with pytest.raises(UrlDenied):
        validate_url("not a url", policy())
    with pytest.raises(UrlDenied, match="credentials"):
        validate_url("https://user:pw@docs.example.com/", policy())
    with pytest.raises(UrlDenied, match="disabled"):
        validate_url("https://docs.example.com/", policy(allowed_hosts=()))


def test_validate_url_blocks_private_unless_allowed():
    with pytest.raises(UrlDenied, match="private"):
        validate_url("http://169.254.169.254/latest", policy(allowed_hosts=("169.254.169.254",)))
    assert (
        validate_url(
            "http://127.0.0.1:8080/",
            policy(allowed_hosts=("127.0.0.1:8080",), allow_private_networks=True),
        ).hostname
        == "127.0.0.1"
    )


def _mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_fetch_bounded_returns_body_and_truncates():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/big":
            # streamed without a content-length header, so the byte cap applies while reading
            return httpx.Response(
                200, stream=httpx.ByteStream(b"x" * 5000), headers={"content-type": "text/plain"}
            )
        if request.url.path == "/declared":
            return httpx.Response(
                200,
                content=b"x" * 5000,
                headers={"content-type": "text/plain", "content-length": "5000"},
            )
        if request.url.path == "/redirect":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/"})
        return httpx.Response(200, json={"ok": True})

    async with _mock_client(handler) as client:
        ok = await fetch_bounded("https://docs.example.com/ok", policy(), client)
        assert ok.status == 200 and "application/json" in ok.content_type and not ok.truncated
        big = await fetch_bounded("https://docs.example.com/big", policy(), client)
        assert big.truncated and len(big.body) == 1000
        with pytest.raises(UrlDenied, match="larger than"):
            await fetch_bounded("https://docs.example.com/declared", policy(), client)
        redirect = await fetch_bounded("https://docs.example.com/redirect", policy(), client)
        assert redirect.status == 302 and redirect.body == ""


async def test_fetch_bounded_timeout_and_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    async with _mock_client(handler) as client:
        with pytest.raises(UrlDenied, match="timed out"):
            await fetch_bounded("https://docs.example.com/slow", policy(), client)

    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async with _mock_client(broken) as client:
        with pytest.raises(UrlDenied, match="request failed"):
            await fetch_bounded("https://docs.example.com/", policy(), client)
