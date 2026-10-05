import runpy
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/gen_env_table.py"
generator = runpy.run_path(str(SCRIPT))


def test_implementations_define_the_same_environment_names():
    ts = generator["typescript_defaults"]((ROOT / "typescript/src/config.ts").read_text())
    py = generator["python_names"]((ROOT / "python/src/secure_mcp_server/config.py").read_text())
    assert set(ts) == py
    assert len(ts) == 16
    assert ts["MCP_FETCH_TIMEOUT_MS"] == "`10000`"


def test_config_documentation_is_current():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_check_detects_staleness_without_writing(tmp_path):
    for path in [
        "scripts/gen_env_table.py",
        "typescript/src/config.ts",
        "python/src/secure_mcp_server/config.py",
        "README.md",
    ]:
        out = tmp_path / path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes((ROOT / path).read_bytes())
    readme = tmp_path / "README.md"
    readme.write_text(readme.read_text().replace("`3000`", "`9999`"))
    before = readme.read_bytes()
    result = subprocess.run(
        [sys.executable, str(tmp_path / "scripts/gen_env_table.py"), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert readme.read_bytes() == before


def test_mismatched_implementations_are_rejected(tmp_path):
    for path in ["typescript/src/config.ts", "python/src/secure_mcp_server/config.py"]:
        out = tmp_path / path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes((ROOT / path).read_bytes())
    config = tmp_path / "python/src/secure_mcp_server/config.py"
    config.write_text(config.read_text().replace('"MCP_PORT"', '"MCP_DIFFERENT_PORT"'))
    import pytest

    with pytest.raises(ValueError, match="environment variables differ"):
        generator["table"](tmp_path)
