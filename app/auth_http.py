from __future__ import annotations

from collections.abc import Callable
from typing import Awaitable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.auth_tokens import decode_access_token
from app.panel_auth_settings import get_panel_auth_settings


def extract_bearer_token(request: Request, *, cookie_name: str) -> str | None:
    auth = request.headers.get("authorization") or ""
    auth = auth.strip()
    if auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
        if tok:
            return tok
    c = request.cookies.get(cookie_name)
    if c and c.strip():
        return c.strip()
    return None


def _path_public(path: str, method: str) -> bool:
    if path == "/" and method == "GET":
        return True
    if path == "/health" and method == "GET":
        return True
    if path.startswith("/static/"):
        return True
    if path in ("/api/auth/login", "/api/auth/status"):
        return True
    if path == "/api/auth/logout" and method == "POST":
        return True
    return False


def _openapi_public(path: str, settings) -> bool:
    if not settings.expose_openapi:
        return False
    if path.startswith("/docs") or path.startswith("/redoc"):
        return True
    if path in ("/openapi.json",):
        return True
    return False


class PanelAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.method == "OPTIONS":
            return await call_next(request)

        settings = get_panel_auth_settings()
        if not settings.auth_active():
            return await call_next(request)

        path = request.url.path
        method = request.method.upper()

        if _path_public(path, method) or _openapi_public(path, settings):
            return await call_next(request)

        token = extract_bearer_token(request, cookie_name=settings.cookie_name)
        if not token:
            return JSONResponse({"detail": "Требуется аутентификация"}, status_code=401)

        try:
            payload = decode_access_token(token, settings.effective_jwt_secret())
        except Exception:
            return JSONResponse({"detail": "Недействительный или просроченный токен"}, status_code=401)

        sub = str(payload.get("sub") or "")
        if not sub:
            return JSONResponse({"detail": "Недействительный токен"}, status_code=401)

        request.state.panel_user = sub
        return await call_next(request)
