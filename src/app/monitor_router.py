from __future__ import annotations

from fastapi import APIRouter

from app.monitor_schemas import MonitorSettingsUpdate, MonitorStatusResponse
from app.monitor_store import load_monitor_settings, save_monitor_settings
from app.monitor_scheduler import get_status_snapshot, is_running, run_check_now
from app.telegram_notify import send_telegram_message

router = APIRouter(prefix="/api/monitor", tags=["monitor"])


@router.get("/settings")
async def api_monitor_get_settings():
    settings = await load_monitor_settings()
    return settings.model_dump(mode="json")


@router.put("/settings")
async def api_monitor_put_settings(body: MonitorSettingsUpdate):
    settings = await save_monitor_settings(body)
    return settings.model_dump(mode="json")


@router.get("/status")
async def api_monitor_status():
    snapshot = get_status_snapshot()
    resp = MonitorStatusResponse(
        running=is_running(),
        servers={sid: s for sid, s in snapshot.items()},
    )
    return resp.model_dump(mode="json")


@router.post("/check-now")
async def api_monitor_check_now():
    snapshot = await run_check_now()
    return {
        "ok": True,
        "servers": {sid: s.model_dump(mode="json") for sid, s in snapshot.items()},
    }


@router.post("/test-telegram")
async def api_monitor_test_telegram(body: MonitorSettingsUpdate):
    token = body.telegram_bot_token.strip()
    chat = body.telegram_chat_id.strip()
    if not token or not chat:
        return {"ok": False, "message": "Укажите bot_token и chat_id"}
    ok, msg = await send_telegram_message(
        token,
        chat,
        "✅ <b>Тест уведомлений Dedus MTProxy</b>\nМониторинг настроен корректно.",
    )
    return {"ok": ok, "message": msg}
