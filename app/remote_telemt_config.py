"""Считывание уже развёрнутого telemt.toml с сервера по SSH."""

from __future__ import annotations

import re
import shlex
import tomllib
from typing import Any

import asyncssh
from pydantic import ValidationError

from app.deploy import _run_plain_capture
from app.schemas import SSHAuth, TelemtConfigPayload
from app.ssh_conn import build_asyncssh_connect_kwargs

TELEMT_TOML_PATH = "/etc/telemt/telemt.toml"


def _nested(d: Any, *keys: str) -> dict[str, Any] | None:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur if isinstance(cur, dict) else None


def _as_str(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return None


def _as_int(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    return None


def _as_bool(v: Any, default: bool) -> bool:
    if isinstance(v, bool):
        return v
    return default


def _as_str_list(v: Any) -> list[str] | None:
    if v is None:
        return None
    if isinstance(v, list) and all(isinstance(x, str) for x in v):
        return list(v)
    return None


_HEX32 = re.compile(r"^[0-9a-fA-F]{32}$")


def parse_telemt_toml_content(raw: str) -> TelemtConfigPayload:
    """Разбор содержимого telemt.toml в полезную нагрузку панели."""
    raw = raw.strip()
    if not raw:
        raise ValueError("Пустой файл")

    try:
        doc = tomllib.loads(raw)
    except tomllib.TOMLDecodeError as e:
        raise ValueError(f"Некорректный TOML: {e}") from e

    general = _nested(doc, "general") or {}
    links = general.get("links")
    links = links if isinstance(links, dict) else {}
    modes = general.get("modes")
    modes = modes if isinstance(modes, dict) else {}

    server = doc.get("server")
    server = server if isinstance(server, dict) else {}
    server_api = server.get("api")
    server_api = server_api if isinstance(server_api, dict) else {}

    censorship = doc.get("censorship")
    censorship = censorship if isinstance(censorship, dict) else {}

    access = doc.get("access")
    access = access if isinstance(access, dict) else {}
    users_tbl = access.get("users")
    users_tbl = users_tbl if isinstance(users_tbl, dict) else {}

    users: list[dict[str, str]] = []
    for username, secret in users_tbl.items():
        if not isinstance(username, str) or not isinstance(secret, str):
            continue
        sec = secret.strip().strip('"').strip("'")
        if not _HEX32.match(sec):
            continue
        users.append({"username": username.strip(), "secret_hex": sec.lower()})

    if not users:
        raise ValueError("В [access.users] нет пользователей с секретом из 32 hex-символов")

    ad_tag = _as_str(general.get("ad_tag"))
    if not ad_tag:
        raise ValueError("Нет или пустой [general].ad_tag")

    log_level = _as_str(general.get("log_level")) or "normal"
    if log_level not in ("debug", "verbose", "normal", "silent"):
        log_level = "normal"

    public_host = _as_str(links.get("public_host"))
    if not public_host:
        raise ValueError("Нет или пустой [general.links].public_host")

    public_port = _as_int(links.get("public_port"))
    if public_port is None:
        raise ValueError("Нет [general.links].public_port")

    server_port = _as_int(server.get("port"))
    if server_port is None:
        raise ValueError("Нет [server].port")

    metrics_port = _as_int(server.get("metrics_port"))
    if metrics_port is None:
        raise ValueError("Нет [server].metrics_port")

    metrics_whitelist = _as_str_list(server.get("metrics_whitelist"))
    if metrics_whitelist is None:
        metrics_whitelist = ["127.0.0.1/32", "::1/128"]

    api_listen = _as_str(server_api.get("listen")) or "127.0.0.1:9091"
    api_whitelist = _as_str_list(server_api.get("whitelist"))
    if api_whitelist is None:
        api_whitelist = ["127.0.0.1/32", "::1/128"]

    tls_domain = _as_str(censorship.get("tls_domain"))
    if not tls_domain:
        raise ValueError("Нет или пустой [censorship].tls_domain")

    data = {
        "public_host": public_host,
        "public_port": public_port,
        "server_port": server_port,
        "metrics_port": metrics_port,
        "api_listen": api_listen,
        "tls_domain": tls_domain,
        "ad_tag": ad_tag.lower(),
        "users": users,
        "mode_classic": _as_bool(modes.get("classic"), False),
        "mode_secure": _as_bool(modes.get("secure"), False),
        "mode_tls": _as_bool(modes.get("tls"), True),
        "log_level": log_level,
        "metrics_whitelist": metrics_whitelist,
        "api_whitelist": api_whitelist,
    }
    try:
        return TelemtConfigPayload.model_validate(data)
    except ValidationError as e:
        raise ValueError(str(e)) from e


async def _try_sftp_read(conn: asyncssh.SSHClientConnection, path: str) -> str | None:
    try:
        async with conn.start_sftp_client() as sftp:
            async with sftp.open(path, "r") as rf:
                data = await rf.read()
        if isinstance(data, bytes):
            return data.decode("utf-8", errors="replace")
        return str(data)
    except Exception:
        return None


async def read_telemt_toml_remote(conn: asyncssh.SSHClientConnection) -> tuple[bool, str]:
    """
    Возвращает (найден_и_прочитан, текст).
    Пробует SFTP, затем cat и sudo -n cat.
    """
    path = TELEMT_TOML_PATH
    q = shlex.quote(path)

    text = await _try_sftp_read(conn, path)
    if text is not None and text.strip():
        return True, text

    out, rc = await _run_plain_capture(conn, f"test -r {q} && cat {q}")
    if rc == 0 and out.strip():
        return True, out

    out2, rc2 = await _run_plain_capture(
        conn, f"sudo -n test -r {q} && sudo -n cat {q}"
    )
    if rc2 == 0 and out2.strip():
        return True, out2

    return False, ""


async def fetch_telemt_config_from_server(ssh: SSHAuth) -> tuple[bool, bool, str | None, TelemtConfigPayload | None]:
    """
    Подключение по SSH и разбор telemt.toml.

    Возвращает (успех_подключения, файл_найден, сообщение_об_ошибке_или_инфо, payload).
    """
    kw = build_asyncssh_connect_kwargs(ssh)
    try:
        async with asyncssh.connect(**kw) as conn:
            found, raw = await read_telemt_toml_remote(conn)
            if not found:
                return True, False, f"Файл {TELEMT_TOML_PATH} не найден или не читается", None
            try:
                cfg = parse_telemt_toml_content(raw)
            except ValueError as e:
                return True, True, str(e), None
            return True, True, "Конфиг Telemt считан с сервера", cfg
    except Exception as e:
        return False, False, str(e), None
