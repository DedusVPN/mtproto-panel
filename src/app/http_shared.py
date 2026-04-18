from __future__ import annotations

import httpx

_shared: httpx.AsyncClient | None = None


def shared_http_client() -> httpx.AsyncClient:
    global _shared
    if _shared is None:
        _shared = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=30.0),
            follow_redirects=True,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=25),
        )
    return _shared


async def close_shared_http_client() -> None:
    global _shared
    if _shared is not None:
        await _shared.aclose()
        _shared = None
