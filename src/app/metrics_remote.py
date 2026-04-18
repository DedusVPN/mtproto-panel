"""Считывание /metrics с удалённого сервера Telemt по SSH (localhost на стороне VPS)."""

from __future__ import annotations

import shlex

import asyncssh

from app.deploy import _run_plain_capture
from app.schemas import SSHAuth
from app.ssh_conn import build_asyncssh_connect_kwargs


async def fetch_remote_prometheus_metrics(ssh: SSHAuth, metrics_port: int) -> tuple[bool, str, str]:
    """
    Выполняет curl или wget к http://127.0.0.1:<port>/metrics на удалённой машине.

    Возвращает (успех, сообщение_при_ошибке_или_кратко_ok, тело_ответа).
    """
    if metrics_port < 1 or metrics_port > 65535:
        return False, "Некорректный metrics_port", ""
    url = f"http://127.0.0.1:{metrics_port}/metrics"
    inner = (
        f"(command -v curl >/dev/null 2>&1 && curl -fsS --max-time 25 {shlex.quote(url)}) || "
        f"(command -v wget >/dev/null 2>&1 && wget -qO- --timeout=25 {shlex.quote(url)}) || "
        f"exit 7"
    )
    cmd = f"bash -lc {shlex.quote(inner)}"
    kw = build_asyncssh_connect_kwargs(ssh)
    try:
        async with asyncssh.connect(**kw) as conn:
            out, rc = await _run_plain_capture(conn, cmd)
    except Exception as e:
        return False, str(e), ""
    body = (out or "").strip()
    if rc == 7 or not body:
        return False, "Не удалось получить /metrics (curl/wget или порт недоступен с localhost на сервере)", ""
    if not body.startswith("#") and "telemt_" not in body:
        return False, "Ответ не похож на метрики Telemt", body[:4000]
    return True, "ok", out
