from __future__ import annotations

from starlette.websockets import WebSocket

from app.auth_tokens import decode_access_token
from app.panel_auth_settings import get_panel_auth_settings


async def require_panel_ws_or_close(ws: WebSocket) -> bool:
    """
    После await ws.accept(): проверяет JWT (cookie или query access_token).
    При ошибке отправляет JSON и закрывает сокет.
    """
    settings = get_panel_auth_settings()
    if not settings.auth_active():
        return True
    token = (ws.query_params.get("access_token") or "").strip() or (
        ws.cookies.get(settings.cookie_name) or ""
    ).strip()
    if not token:
        try:
            await ws.send_json({"type": "error", "message": "Требуется вход в панель"})
        except Exception:
            pass
        try:
            await ws.close(code=1008)
        except Exception:
            pass
        return False
    try:
        decode_access_token(token, settings.effective_jwt_secret())
    except Exception:
        try:
            await ws.send_json({"type": "error", "message": "Сессия недействительна или истекла"})
        except Exception:
            pass
        try:
            await ws.close(code=1008)
        except Exception:
            pass
        return False
    return True
