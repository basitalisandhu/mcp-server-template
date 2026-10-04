"""Runtime settings, read once from the environment at start-up.

Every security-relevant default is the safe one: stdio transport, HTTP bound to loopback,
no file system roots, no network hosts, private networks blocked.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

MIN_TOKEN_LENGTH = 32
LOG_LEVELS = ("debug", "info", "warning", "error")


class SettingsError(ValueError):
    pass


def _int(env: Mapping[str, str], key: str, default: int, lo: int, hi: int) -> int:
    raw = env.get(key, "")
    if raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SettingsError(f"{key} must be an integer between {lo} and {hi}") from exc
    if not lo <= value <= hi:
        raise SettingsError(f"{key} must be an integer between {lo} and {hi}")
    return value


def _list(env: Mapping[str, str], key: str) -> tuple[str, ...]:
    raw = env.get(key, "")
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def _bool(env: Mapping[str, str], key: str, default: bool) -> bool:
    raw = env.get(key, "")
    if raw == "":
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    server_name: str = "secure-mcp-server"
    server_version: str = "0.1.0"
    transport: str = "stdio"
    host: str = "127.0.0.1"
    port: int = 3000
    auth_token: str | None = None
    allowed_http_hosts: tuple[str, ...] = field(default_factory=tuple)
    allowed_dirs: tuple[str, ...] = field(default_factory=tuple)
    allowed_hosts: tuple[str, ...] = field(default_factory=tuple)
    allow_private_networks: bool = False
    max_file_bytes: int = 1_000_000
    max_response_bytes: int = 1_000_000
    fetch_timeout_seconds: float = 10.0
    max_body_bytes: int = 1_000_000
    rate_limit_per_minute: int = 120
    log_level: str = "info"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        transport = env.get("MCP_TRANSPORT", "stdio").lower()
        if transport not in {"stdio", "http"}:
            raise SettingsError('MCP_TRANSPORT must be "stdio" or "http"')
        token = env.get("MCP_AUTH_TOKEN") or None
        if transport == "http" and (token is None or len(token) < MIN_TOKEN_LENGTH):
            raise SettingsError(
                f"MCP_AUTH_TOKEN must be set to at least {MIN_TOKEN_LENGTH} characters when "
                "MCP_TRANSPORT=http (generate one with: openssl rand -hex 32)"
            )
        log_level = env.get("LOG_LEVEL", "info").lower()
        if log_level not in LOG_LEVELS:
            raise SettingsError(f"LOG_LEVEL must be one of {', '.join(LOG_LEVELS)}")
        return cls(
            server_name=env.get("MCP_SERVER_NAME", "secure-mcp-server"),
            server_version=env.get("MCP_SERVER_VERSION", "0.1.0"),
            transport=transport,
            host=env.get("MCP_HOST", "127.0.0.1"),
            port=_int(env, "MCP_PORT", 3000, 0, 65535),
            auth_token=token,
            allowed_http_hosts=_list(env, "MCP_ALLOWED_HTTP_HOSTS"),
            allowed_dirs=_list(env, "MCP_ALLOWED_DIRS"),
            allowed_hosts=tuple(h.lower() for h in _list(env, "MCP_ALLOWED_HOSTS")),
            allow_private_networks=_bool(env, "MCP_ALLOW_PRIVATE_NETWORKS", False),
            max_file_bytes=_int(env, "MCP_MAX_FILE_BYTES", 1_000_000, 1, 100_000_000),
            max_response_bytes=_int(env, "MCP_MAX_RESPONSE_BYTES", 1_000_000, 1, 100_000_000),
            fetch_timeout_seconds=_int(env, "MCP_FETCH_TIMEOUT_MS", 10_000, 100, 120_000) / 1000,
            max_body_bytes=_int(env, "MCP_MAX_BODY_BYTES", 1_000_000, 1024, 100_000_000),
            rate_limit_per_minute=_int(env, "MCP_RATE_LIMIT_PER_MINUTE", 120, 1, 100_000),
            log_level=log_level,
        )
