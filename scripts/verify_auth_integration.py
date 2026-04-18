#!/usr/bin/env python3
"""Локальная проверка auth: HTTP + WebSocket. Пароль: AUTH_TEST_PASSWORD или secrets/panel_initial_password.txt (последняя непустая строка)."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _panel_password() -> str | None:
    if p := os.environ.get("AUTH_TEST_PASSWORD", "").strip():
        return p
    fp = ROOT / "secrets" / "panel_initial_password.txt"
    if not fp.is_file():
        return None
    lines = [ln.strip() for ln in fp.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return lines[-1] if lines else None


def _cookie_name() -> str:
    from app.panel_auth_settings import get_panel_auth_settings

    return get_panel_auth_settings().cookie_name


async def _check_ws(url: str, *, cookie: str | None, expect_auth_fail: bool) -> None:
    import websockets
    from websockets.exceptions import ConnectionClosed

    headers = {"Cookie": cookie} if cookie else None
    try:
        async with websockets.connect(
            url,
            additional_headers=headers,
            open_timeout=5,
            close_timeout=3,
        ) as ws:
            if expect_auth_fail:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    msg = json.loads(raw)
                    if msg.get("type") == "error":
                        return
                except ConnectionClosed:
                    return
                except json.JSONDecodeError:
                    return
                raise AssertionError(f"WS без auth: неожиданное сообщение {raw!r}")
            await ws.send("{}")
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
    except ConnectionClosed:
        if expect_auth_fail:
            return
        raise AssertionError("WS с auth: соединение закрыто до ответа") from None

    msg = json.loads(raw)
    if msg.get("type") != "error":
        raise AssertionError(f"WS с auth после '{{}}' ожидался type=error, получено {msg!r}")


async def amain(base: str) -> list[str]:
    from urllib.parse import urlparse

    from app.panel_auth_settings import get_panel_auth_settings

    errs: list[str] = []
    s0 = get_panel_auth_settings()
    if urlparse(base).scheme == "http" and s0.auth_active() and s0.cookie_secure:
        errs.append(
            "По http:// при PANEL_COOKIE_SECURE=true браузер не отправляет cookie. "
            "Для доступа по IP без SSL в .env должно быть PANEL_COOKIE_SECURE=false (см. .env.example)."
        )
        return errs

    ws_base = base.replace("http://", "ws://").replace("https://", "wss://")
    pw = _panel_password()
    cname = _cookie_name()

    async with httpx.AsyncClient(base_url=base, timeout=20.0) as c:
        r = await c.get("/health")
        if r.status_code != 200:
            errs.append(f"/health -> {r.status_code}")

        r = await c.get("/api/auth/status")
        if r.status_code != 200:
            errs.append(f"/api/auth/status -> {r.status_code}")
        else:
            st = r.json()
            if not st.get("auth_required"):
                errs.append("ожидался auth_required=true (проверьте PANEL_* в .env)")

        r = await c.get("/api/presets")
        if r.status_code != 401:
            errs.append(f"GET /api/presets без входа ожидался 401, получено {r.status_code}")

        r = await c.post("/api/auth/login", json={"username": "admin", "password": "___wrong___"})
        if r.status_code != 401:
            errs.append(f"логин с неверным паролем ожидался 401, получено {r.status_code}")

        if not pw:
            errs.append("нет пароля: AUTH_TEST_PASSWORD или secrets/panel_initial_password.txt")
            return errs

        r = await c.post("/api/auth/login", json={"username": "admin", "password": pw})
        if r.status_code != 200:
            errs.append(f"логин admin ожидался 200, получено {r.status_code}: {r.text[:120]}")
            return errs

        body = r.json()
        token = body.get("access_token")
        if not token:
            errs.append("в ответе login нет access_token")

        if cname not in r.cookies:
            errs.append(f"в ответе login нет cookie {cname!r}")

        r = await c.get("/api/presets")
        if r.status_code != 200:
            errs.append(f"GET /api/presets с cookie ожидался 200, получено {r.status_code}")

        r = await c.get("/api/auth/me")
        uname = get_panel_auth_settings().admin_username.strip()
        if r.status_code != 200 or r.json().get("sub") != uname:
            errs.append(f"/api/auth/me -> {r.status_code} {r.text[:120]}")

        async with httpx.AsyncClient(base_url=base, timeout=20.0) as c2:
            r = await c2.get(
                "/api/presets",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code != 200:
                errs.append(f"Bearer /api/presets ожидался 200, получено {r.status_code}")

        r = await c.post("/api/auth/logout")
        if r.status_code != 200:
            errs.append(f"logout -> {r.status_code}")

        r = await c.get("/api/presets")
        if r.status_code != 401:
            errs.append(f"после logout ожидался 401, получено {r.status_code}")

    await _check_ws(f"{ws_base}/ws/deploy", cookie=None, expect_auth_fail=True)

    async with httpx.AsyncClient(base_url=base, timeout=20.0) as c:
        r = await c.post("/api/auth/login", json={"username": "admin", "password": pw})
        r.raise_for_status()
        cookie_hdr = f"{cname}={r.cookies[cname]}"

    await _check_ws(f"{ws_base}/ws/deploy", cookie=cookie_hdr, expect_auth_fail=False)

    s = get_panel_auth_settings()
    async with httpx.AsyncClient(base_url=base, timeout=5.0) as c3:
        r = await c3.get("/openapi.json")
    if s.expose_openapi:
        if r.status_code != 200:
            errs.append(f"PANEL_EXPOSE_OPENAPI=true но /openapi.json -> {r.status_code}")
    else:
        if r.status_code != 401:
            errs.append(f"PANEL_EXPOSE_OPENAPI=false но /openapi.json без cookie -> {r.status_code}, ожидался 401")

    return errs


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://127.0.0.1:8765", help="Базовый URL панели")
    args = p.parse_args()
    errs = asyncio.run(amain(args.base.rstrip("/")))
    if errs:
        print("FAIL:")
        for e in errs:
            print(" -", e)
        return 1
    print("OK: /health, /api/auth/status, 401 без сессии, 401 неверный пароль,")
    print("    login+cookie+me, Bearer, logout+401, WS без auth, WS с cookie+ошибка валидации,")
    print("    /openapi.json согласно PANEL_EXPOSE_OPENAPI")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
