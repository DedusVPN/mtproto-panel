from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path

from app.server_schemas import (
    ServerListItem,
    StoredServer,
    StoredServerCreate,
    StoredServerUpdate,
)

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_FILE = _DATA_DIR / "servers.json"
_lock = asyncio.Lock()


def _ensure_data_dir() -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)


def _chmod_private(path: Path) -> None:
    try:
        os.chmod(path, 0o600)
    except (NotImplementedError, OSError, AttributeError):
        pass


def _read_raw() -> list[dict]:
    if not _FILE.is_file():
        return []
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    if not isinstance(data, list):
        return []
    return data


def _write_atomic(servers: list[StoredServer]) -> None:
    _ensure_data_dir()
    payload = [s.model_dump(mode="json") for s in servers]
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    tmp = _FILE.with_suffix(".json.tmp")
    tmp.write_text(raw, encoding="utf-8")
    _chmod_private(tmp)
    tmp.replace(_FILE)
    _chmod_private(_FILE)


async def list_servers() -> list[ServerListItem]:
    async with _lock:
        raw = _read_raw()
    items: list[ServerListItem] = []
    for row in raw:
        try:
            s = StoredServer.model_validate(row)
        except Exception:
            continue
        items.append(
            ServerListItem(
                id=s.id,
                name=s.name,
                host=s.host,
                port=s.port,
                username=s.username,
                auth_mode=s.auth_mode,
            )
        )
    return items


async def get_server(server_id: str) -> StoredServer | None:
    async with _lock:
        raw = _read_raw()
    for row in raw:
        if row.get("id") != server_id:
            continue
        try:
            return StoredServer.model_validate(row)
        except Exception:
            return None
    return None


async def create_server(body: StoredServerCreate) -> StoredServer:
    new_id = str(uuid.uuid4())
    rec = StoredServer(
        id=new_id,
        name=body.name.strip(),
        host=body.host.strip(),
        port=body.port,
        username=body.username.strip(),
        auth_mode=body.auth_mode,
        private_key=(body.private_key or "").strip() or None,
        private_key_passphrase=body.private_key_passphrase,
        password=(body.password or "").strip() or None,
    )
    async with _lock:
        servers = []
        for row in _read_raw():
            try:
                servers.append(StoredServer.model_validate(row))
            except Exception:
                continue
        servers.append(rec)
        _write_atomic(servers)
    return rec


async def update_server(server_id: str, body: StoredServerUpdate) -> StoredServer | None:
    rec = StoredServer(
        id=server_id,
        name=body.name.strip(),
        host=body.host.strip(),
        port=body.port,
        username=body.username.strip(),
        auth_mode=body.auth_mode,
        private_key=(body.private_key or "").strip() or None,
        private_key_passphrase=body.private_key_passphrase,
        password=(body.password or "").strip() or None,
    )
    async with _lock:
        servers: list[StoredServer] = []
        found = False
        for row in _read_raw():
            try:
                s = StoredServer.model_validate(row)
            except Exception:
                continue
            if s.id == server_id:
                servers.append(rec)
                found = True
            else:
                servers.append(s)
        if not found:
            return None
        _write_atomic(servers)
    return rec


async def delete_server(server_id: str) -> bool:
    async with _lock:
        servers: list[StoredServer] = []
        removed = False
        for row in _read_raw():
            try:
                s = StoredServer.model_validate(row)
            except Exception:
                continue
            if s.id == server_id:
                removed = True
                continue
            servers.append(s)
        if not removed:
            return False
        _write_atomic(servers)
    return True
