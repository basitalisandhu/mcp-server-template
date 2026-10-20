from __future__ import annotations

from pathlib import Path

import pytest

from secure_mcp_server.safety.paths import PathDenied, read_bounded, safe_join


def test_refuses_everything_without_roots():
    with pytest.raises(PathDenied, match="disabled"):
        safe_join([], "a.txt")


def test_accepts_relative_and_absolute_inside(docs_root: Path):
    real = (docs_root / "notes.txt").resolve()
    assert safe_join([docs_root], "notes.txt") == real
    assert safe_join([docs_root], str(docs_root / "notes.txt")) == real
    assert safe_join([docs_root], "dir/new.txt").is_relative_to(docs_root.resolve())


def test_refuses_traversal_null_bytes_and_symlink_escapes(docs_root: Path):
    outside = docs_root.parent / "outside"
    for bad in [
        "../outside/secret.txt",
        str(outside / "secret.txt"),
        "a\0.txt",
        "link-out",
        "dir-out/secret.txt",
        "../../etc/passwd",
    ]:
        with pytest.raises(PathDenied):
            safe_join([docs_root], bad)


def test_read_bounded(docs_root: Path):
    file = safe_join([docs_root], "notes.txt")
    assert read_bounded(file, 100) == "line one\nline two\n"
    with pytest.raises(PathDenied, match="larger than"):
        read_bounded(file, 2)
    with pytest.raises(PathDenied, match="regular file"):
        read_bounded(safe_join([docs_root], "dir"), 100)
    with pytest.raises(FileNotFoundError):
        read_bounded(safe_join([docs_root], "missing.txt"), 100)


def test_accepts_absolute_paths_spelt_through_a_symlinked_root(docs_root: Path):
    alias = docs_root.parent / "root-alias"
    alias.symlink_to(docs_root, target_is_directory=True)
    real = (docs_root / "notes.txt").resolve()
    assert safe_join([alias], str(alias / "notes.txt")) == real
    assert safe_join([alias], "notes.txt") == real
    for bad in [str(alias / "link-out"), str(alias / ".." / "outside" / "secret.txt")]:
        with pytest.raises(PathDenied):
            safe_join([alias], bad)
