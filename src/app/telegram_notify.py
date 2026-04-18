from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_TG_BASE = "https://api.telegram.org"


def _build_send_url(api_base_url: str, token: str) -> str:
    """
    Формирует URL эндпоинта sendMessage.

    Если api_base_url не задан — используется официальный api.telegram.org.
    Поддерживаемые форматы кастомного адреса:
      https://my-proxy.example.com          → .../botTOKEN/sendMessage
      https://my-proxy.example.com/tg       → .../tg/botTOKEN/sendMessage
    """
    base = (api_base_url or "").strip().rstrip("/") or _DEFAULT_TG_BASE
    return f"{base}/bot{token}/sendMessage"


async def send_telegram_message(
    bot_token: str,
    chat_id: str,
    text: str,
    api_base_url: str = "",
) -> tuple[bool, str]:
    """
    Отправляет сообщение через Telegram Bot API (официальный или кастомный).

    Возвращает (успех, описание_ошибки_или_ok).
    """
    if not bot_token or not chat_id:
        return False, "bot_token или chat_id не настроены"
    url = _build_send_url(api_base_url, bot_token)
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
    api_base_url: str = "",
) -> None:
    text = (
        f"🔴 <b>MTProxy недоступен</b>\n"
        f"Сервер: <b>{_esc(server_name)}</b>\n"
        f"Адрес: <code>{_esc(host)}:{proxy_port}</code>\n"
        f"Причина: {_esc(error)}"
    )
    ok, msg = await send_telegram_message(bot_token, chat_id, text, api_base_url)
    if not ok:
        logger.warning("Не удалось отправить уведомление Telegram (down): %s", msg)


async def notify_proxy_up(
    bot_token: str,
    chat_id: str,
    server_name: str,
    host: str,
    proxy_port: int,
    api_base_url: str = "",
) -> None:
    text = (
        f"✅ <b>MTProxy снова доступен</b>\n"
        f"Сервер: <b>{_esc(server_name)}</b>\n"
        f"Адрес: <code>{_esc(host)}:{proxy_port}</code>"
    )
    ok, msg = await send_telegram_message(bot_token, chat_id, text, api_base_url)
    if not ok:
        logger.warning("Не удалось отправить уведомление Telegram (up): %s", msg)


def _esc(s: str) -> str:
    """Минимальное экранирование для Telegram HTML-разметки."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
