"""Entry point: ``python -m secure_mcp_server`` or the ``secure-mcp-server`` script."""

from __future__ import annotations

import sys

from .config import Settings, SettingsError
from .logging import configure_logging


def main() -> int:
    try:
        settings = Settings.from_env()
    except SettingsError as exc:
        sys.stderr.write(f'{{"level": "error", "msg": "{exc}"}}\n')
        return 1
    log = configure_logging(settings.log_level)
    log.info(
        "starting",
        extra={
            "transport": settings.transport,
            "file_access": bool(settings.allowed_dirs),
            "network_access": bool(settings.allowed_hosts),
        },
    )
    if settings.transport == "http":
        from .http import serve_http

        serve_http(settings)
        return 0
    from .server import build_server

    build_server(settings).run(transport="stdio", show_banner=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
