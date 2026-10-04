"""Bearer token verification for the HTTP transport."""

from __future__ import annotations

import hashlib
import hmac

from fastmcp.server.auth import AccessToken, TokenVerifier


class SharedTokenVerifier(TokenVerifier):
    """Verifies a single shared bearer token with a constant-time comparison."""

    def __init__(self, token: str, base_url: str | None = None):
        super().__init__(base_url=base_url, required_scopes=["mcp"])
        self._expected = hashlib.sha256(token.encode()).digest()

    async def verify_token(self, token: str) -> AccessToken | None:
        given = hashlib.sha256(token.encode()).digest()
        if not hmac.compare_digest(given, self._expected):
            return None
        return AccessToken(token="[shared]", client_id="shared-token", scopes=["mcp"], claims={})
