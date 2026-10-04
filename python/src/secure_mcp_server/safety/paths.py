"""Bounded file access: every path a tool receives is resolved inside an allowlisted root.

A model-supplied path is untrusted input. Prompt injection can make the model ask for
``../../.ssh/id_rsa`` or for a symlink that points outside the project. ``safe_join`` resolves the
real path (following symlinks) and checks the result is still inside one of the allowed roots.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path


class PathDenied(PermissionError):
    pass


def safe_join(allowed_roots: Sequence[str | Path], requested: str) -> Path:
    """Resolve ``requested`` against the allowed roots and return the real, absolute path."""
    if not allowed_roots:
        raise PathDenied("file access is disabled: no allowed directories configured")
    if "\0" in requested:
        raise PathDenied("path contains a null byte")
    for root in allowed_roots:
        try:
            real_root = Path(root).resolve(strict=True)
        except OSError:
            continue
        candidate = Path(requested)
        if not candidate.is_absolute():
            candidate = real_root / candidate
        resolved = candidate.resolve(strict=False)
        if resolved.is_relative_to(real_root):
            return resolved
    raise PathDenied(f"path is outside the allowed directories: {requested}")


def read_bounded(resolved: Path, max_bytes: int) -> str:
    """Read a file that was already resolved with ``safe_join``, enforcing a size cap."""
    if not resolved.exists():
        raise FileNotFoundError(str(resolved))
    if not resolved.is_file():
        raise PathDenied("not a regular file")
    size = resolved.stat().st_size
    if size > max_bytes:
        raise PathDenied(f"file is larger than {max_bytes} bytes")
    return resolved.read_text(encoding="utf-8", errors="replace")
