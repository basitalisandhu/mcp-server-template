from __future__ import annotations

import io
import json

from secure_mcp_server.logging import REDACTED, configure_logging, redact, redact_text


def test_secret_keys_are_masked():
    out = redact(
        {"authorization": "Bearer abc", "api_key": "k", "nested": {"password": "p", "ok": "fine"}}
    )
    assert out["authorization"] == REDACTED and out["api_key"] == REDACTED
    assert out["nested"]["password"] == REDACTED and out["nested"]["ok"] == "fine"


def test_token_values_are_masked_in_text():
    gh = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"
    assert gh not in redact_text(f"token {gh} here")
    assert REDACTED in redact_text("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")
    assert (
        redact_text("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")
        == REDACTED
    )
    assert redact_text("plain text") == "plain text"


def test_json_lines_with_level_and_extra_fields():
    stream = io.StringIO()
    log = configure_logging("info", stream)
    log.debug("hidden")
    log.info("shown", extra={"secret": "x", "count": 2})
    lines = [line for line in stream.getvalue().splitlines() if line]
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["msg"] == "shown" and entry["secret"] == REDACTED and entry["count"] == 2
    assert entry["level"] == "info" and "ts" in entry


def test_exceptions_are_serialised_without_tracebacks():
    stream = io.StringIO()
    log = configure_logging("info", stream)
    try:
        raise ValueError("boom sk-ant-" + "x" * 40)
    except ValueError:
        log.exception("failed")
    entry = json.loads(stream.getvalue().strip())
    assert entry["error"]["type"] == "ValueError" and REDACTED in entry["error"]["message"]
    assert "Traceback" not in stream.getvalue()
