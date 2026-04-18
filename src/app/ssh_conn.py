from __future__ import annotations

from typing import Any

import asyncssh

from app.schemas import SSHAuth


def build_asyncssh_connect_kwargs(ssh: SSHAuth) -> dict[str, Any]:
    """Параметры для asyncssh.connect: либо ключ, либо пароль (взаимоисключающе)."""
    kw: dict[str, Any] = {
        "host": ssh.host,
        "port": ssh.port,
        "username": ssh.username,
        "known_hosts": None,
    }
    key_material = (ssh.private_key or "").strip()
    password = (ssh.password or "").strip()
    if key_material:
        key = asyncssh.import_private_key(
            key_material,
            passphrase=ssh.private_key_passphrase,
        )
        kw["client_keys"] = [key]
    elif password:
        kw["password"] = password
    else:
        raise ValueError("Внутренняя ошибка: нет ни ключа, ни пароля")
    return kw
