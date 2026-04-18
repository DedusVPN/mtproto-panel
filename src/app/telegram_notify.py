from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

_TG_API = "https://api.telegram.org/bot{token}/sendMessage"


async def send_telegram_message(
    bot_token: str,
    chat_id: str,
    text: str,
) -> tuple[bool, str]:
    """
    Отправляет сообщение через Telegram Bot API.

    Возвращает (успех, описание_ошибки_или_ok).
    """
    if not bot_token or not chat_id:
        return False, "bot_token или chat_id не настроены"
    url = _TG_API.format(token=bot_token)
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload)
        if resp.status_code == 200:
            return True, "ok"
        body = resp.text[:500]
        return False, f"HTTP {resp.status_code}: {body}"
    except httpx.RequestError as e:
        return False, f"Сетевая ошибка: {e}"
    except Exception as e:
        return False, str(e)


async def notify_proxy_down(
    bot_token: str,
    chat_id: str,
    server_name: str,
    host: str,
    proxy_port: int,
    error: str,
) -> None:
    text = (
        f"🔴 <b>MTProxy недоступен</b>\n"
        f"Сервер: <b>{_esc(server_name)}</b>\n"
        f"Адрес: <code>{_esc(host)}:{proxy_port}</code>\n"
        f"Причина: {_esc(error)}"
    )
    ok, msg = await send_telegram_message(bot_token, chat_id, text)
    if not ok:
        logger.warning("Не удалось отправить уведомление Telegram (down): %s", msg)


async def notify_proxy_up(
    bot_token: str,
    chat_id: str,
    server_name: str,
    host: str,
    proxy_port: int,
) -> None:
    text = (
        f"✅ <b>MTProxy снова доступен</b>\n"
        f"Сервер: <b>{_esc(server_name)}</b>\n"
        f"Адрес: <code>{_esc(host)}:{proxy_port}</code>"
    )
    ok, msg = await send_telegram_message(bot_token, chat_id, text)
    if not ok:
        logger.warning("Не удалось отправить уведомление Telegram (up): %s", msg)


def _esc(s: str) -> str:
    """Минимальное экранирование для Telegram HTML-разметки."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
