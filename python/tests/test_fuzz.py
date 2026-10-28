"""Seeded fuzz and scaling tests for every reader of untrusted input.

Tool arguments come from a model that reads untrusted text, so URLs, paths and anything
that ends up in a log must be refused with the module's own error (UrlDenied, PathDenied,
SettingsError), never another exception, and never slowly. The private-address table in
test-cases/private-addresses.json is shared with the TypeScript tests.
"""

from __future__ import annotations

import contextlib
import json
import os
import random
import time
from pathlib import Path

import pytest

from secure_mcp_server.config import Settings, SettingsError
from secure_mcp_server.logging import redact, redact_text
from secure_mcp_server.safety.network import (
    NetworkPolicy,
    UrlDenied,
    is_private_address,
    validate_url,
)
from secure_mcp_server.safety.paths import PathDenied, read_bounded, safe_join

CASES = Path(__file__).resolve().parents[2] / "test-cases" / "private-addresses.json"


@pytest.mark.parametrize("host, private", sorted(json.loads(CASES.read_text())["hosts"].items()))
def test_private_address_table_shared_with_typescript(host: str, private: bool) -> None:
    assert is_private_address(host) is private


def _mutate(rng: random.Random, text: str) -> str:
    chars = list(text)
    for _ in range(rng.randrange(1, 6)):
        pos = rng.randrange(len(chars) + 1)
        op = rng.random()
        if op < 0.4:
            chars.insert(pos, rng.choice("[]:@/\\%?#. \t\x00é0x9"))
        elif op < 0.7 and chars:
            del chars[min(pos, len(chars) - 1)]
        else:
            chars[pos:pos] = chars[pos : pos + rng.randrange(1, 8)]
    return "".join(chars)


def test_validate_url_only_ever_raises_url_denied() -> None:
    rng = random.Random(9728)
    allowed = ("docs.example.com", "127.1", "2130706433", "0x7f.1", "localhost.", "[::1]", "::1")
    policy = NetworkPolicy(allowed_hosts=allowed)
    seeds = [
        "https://docs.example.com/a?b=c",
        "http://[::1]:8080/",
        "http://127.1/",
        "http://user:pw@docs.example.com/",
        "https://docs.example.com:443/x",
    ]
    for _ in range(5000):
        url = _mutate(rng, rng.choice(seeds))
        try:
            parts = validate_url(url, policy)
        except UrlDenied:
            continue
        # Anything that passes is on the allowlist and not a private address.
        assert not is_private_address(parts.hostname or "")


@pytest.mark.parametrize(
    "url",
    ["http://127.1/", "http://2130706433/", "http://0x7f.1/", "http://localhost./", "http://[::1"],
)
def test_allowlisted_shorthand_and_malformed_urls_are_denied(url: str) -> None:
    policy = NetworkPolicy(allowed_hosts=("127.1", "2130706433", "0x7f.1", "localhost."))
    with pytest.raises(UrlDenied):
        validate_url(url, policy)


def test_bad_port_is_url_denied() -> None:
    policy = NetworkPolicy(allowed_hosts=("docs.example.com",))
    for url in ("http://docs.example.com:99999/", "http://docs.example.com:abc/"):
        with pytest.raises(UrlDenied, match="not a valid absolute URL"):
            validate_url(url, policy)


def test_safe_join_only_ever_raises_path_denied(tmp_path: Path) -> None:
    (tmp_path / "loop").symlink_to("loop")
    (tmp_path / "a").symlink_to(tmp_path / "b")
    (tmp_path / "b").symlink_to(tmp_path / "a")
    (tmp_path / "bin.dat").write_bytes(bytes(range(256)) * 10)
    rng = random.Random(7)
    requests = ["loop", "loop/x", "a/b/c", "x" * 300, "y/" * 3000, "..\\..", "bin.dat", ""]
    requests += [
        "".join(rng.choice("./ab\\~\x01é") for _ in range(rng.randrange(30))) for _ in range(500)
    ]
    for requested in requests:
        try:
            resolved = safe_join([tmp_path], requested)
        except PathDenied:
            continue
        assert resolved.is_relative_to(tmp_path.resolve())
        with contextlib.suppress(PathDenied, FileNotFoundError):
            read_bounded(resolved, 1_000_000)


def test_settings_only_ever_raise_settings_error() -> None:
    rng = random.Random(3000)
    keys = [
        "MCP_TRANSPORT",
        "MCP_PORT",
        "MCP_AUTH_TOKEN",
        "LOG_LEVEL",
        "MCP_MAX_FILE_BYTES",
        "MCP_FETCH_TIMEOUT_MS",
    ]
    values = [
        "",
        "http",
        "stdio",
        "HTTP",
        "-1",
        "65536",
        "1e3",
        "0x10",
        " 1",
        "x" * 40,
        "\x00",
        "é",
        "debug",
    ]
    for _ in range(2000):
        env = {k: rng.choice(values) for k in rng.sample(keys, rng.randrange(len(keys) + 1))}
        with contextlib.suppress(SettingsError):
            Settings.from_env(env)


def test_redact_handles_deep_and_odd_values() -> None:
    deep: dict = {}
    node = deep
    for _ in range(100_000):
        node["a"] = {}
        node = node["a"]
    assert "[truncated]" in json.dumps(redact(deep))
    assert redact({"token": "x", "n": [1, None, 2.5, {"password": "y"}]}) == {
        "token": "[redacted]",
        "n": [1, None, 2.5, {"password": "[redacted]"}],
    }


def test_pem_redaction_is_linear() -> None:
    # 20,000 BEGIN markers with no END took about 30 s with the lazy regular expression.
    text = ("-----BEGIN RSA PRIVATE " + "KEY-----") * 20_000
    start = time.perf_counter()
    assert redact_text(text) == text
    assert time.perf_counter() - start < 1.0
    # Built from parts so secret scanners do not read the test as a committed key.
    key = "-----BEGIN EC PRIVATE " + "KEY-----\nnot-a-key\n-----END EC PRIVATE " + "KEY-----"
    assert redact_text(f"a {key} b {key} c") == "a [redacted] b [redacted] c"


def test_redact_text_scales_linearly() -> None:
    small = ("Bearer abcdefghijkl and ghp_" + "a" * 36 + " ") * 20_000
    large = small * 10
    start = time.perf_counter()
    redact_text(small)
    t_small = time.perf_counter() - start
    start = time.perf_counter()
    redact_text(large)
    t_large = time.perf_counter() - start
    assert t_large < max(30 * t_small, 0.5), (t_small, t_large)


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_symlink_loop_message_does_not_show_server_paths(tmp_path: Path) -> None:
    (tmp_path / "loop").symlink_to("loop")
    try:
        safe_join([tmp_path], "loop/x")
    except PathDenied as exc:
        assert str(tmp_path) not in str(exc)
