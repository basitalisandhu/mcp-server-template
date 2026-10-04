from __future__ import annotations

import os
from pathlib import Path

import pytest

from secure_mcp_server.config import Settings

TEST_TOKEN = "unit-test-shared-token-0123456789abcdef0123456789"


def settings_for(**env: str) -> Settings:
    base = {"MCP_ALLOW_PRIVATE_NETWORKS": "true"}
    base.update(env)
    return Settings.from_env(base)


@pytest.fixture
def docs_root(tmp_path: Path) -> Path:
    root = tmp_path / "root"
    root.mkdir()
    (root / "notes.txt").write_text("line one\nline two\n", encoding="utf-8")
    (root / "dir").mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("nope", encoding="utf-8")
    os.symlink(outside / "secret.txt", root / "link-out")
    os.symlink(outside, root / "dir-out")
    return root
