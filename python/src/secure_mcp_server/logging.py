"""Structured JSON logging to stderr with secret redaction.

stdout belongs to the stdio transport, so every log line goes to stderr. Each record becomes one
JSON object per line; messages and extra fields pass through ``redact`` first, so a token that
ends up in a log call by mistake is masked rather than written out.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import sys
from typing import Any

REDACTED = "[redacted]"
SECRET_KEY_RE = re.compile(
    r"(token|secret|password|passwd|authorization|api[_-]?key|cookie|credential|private[_-]?key|session)",
    re.I,
)
SECRET_VALUE_PATTERNS = [
    re.compile(r"\bsk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}\b"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(r"\bxox[abprse]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    re.compile(r"\bnpm_[A-Za-z0-9]{36}\b"),
    re.compile(r"\bhf_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
]
_BEARER_RE = re.compile(r"(\b(?:bearer|basic|token)\s+)[A-Za-z0-9._~+/=-]{12,}", re.I)
_STANDARD_ATTRS = set(logging.LogRecord("x", 0, "", 0, "", (), None).__dict__) | {
    "message",
    "asctime",
}


def redact_text(value: str) -> str:
    for pattern in SECRET_VALUE_PATTERNS:
        value = pattern.sub(REDACTED, value)
    return _BEARER_RE.sub(lambda m: m.group(1) + REDACTED, value)


def redact(value: Any, depth: int = 0) -> Any:
    """Deep-copy a value, masking secret-looking keys and token-looking strings."""
    if depth > 8:
        return "[truncated]"
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, BaseException):
        return {"type": type(value).__name__, "message": redact_text(str(value))}
    if isinstance(value, dict):
        return {
            str(k): (REDACTED if SECRET_KEY_RE.search(str(k)) else redact(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [redact(v, depth + 1) for v in value]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return redact_text(str(value))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": dt.datetime.fromtimestamp(record.created, dt.UTC).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": redact_text(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                entry[key] = REDACTED if SECRET_KEY_RE.search(key) else redact(value)
        if record.exc_info and record.exc_info[1] is not None:
            entry["error"] = redact(record.exc_info[1])
        return json.dumps(entry, ensure_ascii=False)


def configure_logging(level: str = "info", stream: Any = None) -> logging.Logger:
    """Configure the package logger to emit JSON lines on stderr (or ``stream``)."""
    logger = logging.getLogger("secure_mcp_server")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream or sys.stderr)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(level.upper())
    logger.propagate = False
    return logger


def get_logger(name: str = "secure_mcp_server") -> logging.Logger:
    return logging.getLogger(name)
