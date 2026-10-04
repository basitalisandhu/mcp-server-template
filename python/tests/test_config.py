from __future__ import annotations

import pytest

from secure_mcp_server.config import MIN_TOKEN_LENGTH, Settings, SettingsError

from .conftest import TEST_TOKEN


def test_defaults_are_safe():
    s = Settings.from_env({})
    assert s.transport == "stdio"
    assert s.host == "127.0.0.1"
    assert s.allowed_dirs == () and s.allowed_hosts == ()
    assert s.allow_private_networks is False
    assert s.rate_limit_per_minute > 0


def test_http_requires_a_long_token():
    with pytest.raises(SettingsError, match="MCP_AUTH_TOKEN"):
        Settings.from_env({"MCP_TRANSPORT": "http"})
    with pytest.raises(SettingsError, match=str(MIN_TOKEN_LENGTH)):
        Settings.from_env({"MCP_TRANSPORT": "http", "MCP_AUTH_TOKEN": "short"})
    s = Settings.from_env({"MCP_TRANSPORT": "http", "MCP_AUTH_TOKEN": TEST_TOKEN})
    assert s.auth_token == TEST_TOKEN


def test_lists_and_bounded_integers():
    s = Settings.from_env(
        {
            "MCP_ALLOWED_DIRS": "/a, /b",
            "MCP_ALLOWED_HOSTS": "Docs.Example.com,api.example.com:8443",
            "MCP_PORT": "8080",
            "MCP_RATE_LIMIT_PER_MINUTE": "5",
            "MCP_FETCH_TIMEOUT_MS": "2500",
        }
    )
    assert s.allowed_dirs == ("/a", "/b")
    assert s.allowed_hosts == ("docs.example.com", "api.example.com:8443")
    assert s.port == 8080 and s.rate_limit_per_minute == 5 and s.fetch_timeout_seconds == 2.5
    with pytest.raises(SettingsError, match="MCP_PORT"):
        Settings.from_env({"MCP_PORT": "70000"})
    with pytest.raises(SettingsError, match="MCP_TRANSPORT"):
        Settings.from_env({"MCP_TRANSPORT": "sse"})
    with pytest.raises(SettingsError, match="LOG_LEVEL"):
        Settings.from_env({"LOG_LEVEL": "loud"})
