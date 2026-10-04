"""Bounded network access for the fetch tool.

Only http(s) URLs whose host is on the allowlist are contacted; loopback, link-local and private
ranges are refused unless explicitly enabled; redirects are not followed; responses are capped in
size and time. These are the server-side request forgery (SSRF) controls.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from urllib.parse import SplitResult, urlsplit

import httpx


class UrlDenied(PermissionError):
    pass


@dataclass(frozen=True)
class NetworkPolicy:
    allowed_hosts: tuple[str, ...]
    allow_private_networks: bool = False
    max_response_bytes: int = 1_000_000
    timeout_seconds: float = 10.0


def is_private_address(host: str) -> bool:
    h = host.lower().strip("[]")
    if h == "localhost" or h.endswith((".localhost", ".local", ".internal")):
        return True
    try:
        addr = ipaddress.ip_address(h)
    except ValueError:
        return False
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or (addr.version == 4 and addr in ipaddress.ip_network("100.64.0.0/10"))
    )


def validate_url(raw: str, policy: NetworkPolicy) -> SplitResult:
    """Validate a model-supplied URL against the policy and return the parsed URL."""
    if not policy.allowed_hosts:
        raise UrlDenied("network access is disabled: no allowed hosts configured")
    parts = urlsplit(raw)
    if parts.scheme not in {"http", "https"}:
        raise UrlDenied(f"scheme not allowed: {parts.scheme or 'none'}")
    if not parts.hostname:
        raise UrlDenied("not a valid absolute URL")
    if parts.username or parts.password:
        raise UrlDenied("credentials in URLs are not allowed")
    hostname = parts.hostname.lower()
    host_with_port = f"{hostname}:{parts.port}" if parts.port else hostname
    if hostname not in policy.allowed_hosts and host_with_port not in policy.allowed_hosts:
        raise UrlDenied(f"host not on the allowlist: {hostname}")
    if not policy.allow_private_networks and is_private_address(hostname):
        raise UrlDenied("private and loopback addresses are blocked")
    return parts


@dataclass(frozen=True)
class FetchResult:
    status: int
    content_type: str
    body: str
    truncated: bool


async def fetch_bounded(
    url: str, policy: NetworkPolicy, client: httpx.AsyncClient | None = None
) -> FetchResult:
    """GET a URL that passed ``validate_url``, with a timeout, a size cap and no redirects."""
    own_client = client is None
    client = client or httpx.AsyncClient()
    try:
        async with client.stream(
            "GET",
            url,
            follow_redirects=False,
            timeout=policy.timeout_seconds,
            headers={
                "accept": "text/*, application/json;q=0.9, */*;q=0.1",
                "user-agent": "secure-mcp-server/0.1",
            },
        ) as response:
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > policy.max_response_bytes:
                raise UrlDenied(f"response larger than {policy.max_response_bytes} bytes")
            chunks: list[bytes] = []
            received = 0
            truncated = False
            async for chunk in response.aiter_bytes():
                received += len(chunk)
                if received > policy.max_response_bytes:
                    chunks.append(chunk[: len(chunk) - (received - policy.max_response_bytes)])
                    truncated = True
                    break
                chunks.append(chunk)
            body = b"".join(chunks).decode("utf-8", errors="replace")
            return FetchResult(
                status=response.status_code,
                content_type=response.headers.get("content-type", ""),
                body=body,
                truncated=truncated,
            )
    except UrlDenied:
        raise
    except httpx.TimeoutException as exc:
        raise UrlDenied(f"request timed out after {policy.timeout_seconds} s") from exc
    except httpx.HTTPError as exc:
        raise UrlDenied(f"request failed: {type(exc).__name__}") from exc
    finally:
        if own_client:
            await client.aclose()
