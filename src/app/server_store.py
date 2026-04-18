from __future__ import annotations

import uuid

from sqlalchemy import delete, select

from app.db import session_factory
from app.models import ServerRow
from app.server_schemas import (
    ServerListItem,
    StoredServer,
    StoredServerCreate,
    StoredServerUpdate,
)


def _row_to_stored(row: ServerRow) -> StoredServer:
    return StoredServer(
        id=row.id,
        name=row.name,
        host=row.host,
        port=row.port,
        username=row.username,
        auth_mode=row.auth_mode,  # type: ignore[arg-type]
        private_key=row.private_key,
        private_key_passphrase=row.private_key_passphrase,
        password=row.password,
    )


async def list_servers() -> list[ServerListItem]:
    fac = session_factory()
    async with fac() as session:
        result = await session.scalars(select(ServerRow).order_by(ServerRow.name))
        rows = list(result.all())
    items: list[ServerListItem] = []
    for row in rows:
        try:
            s = _row_to_stored(row)
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
    fac = session_factory()
    async with fac() as session:
        row = await session.get(ServerRow, server_id)
        if row is None:
            return None
        try:
            return _row_to_stored(row)
        except Exception:
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
    row = ServerRow(
        id=rec.id,
        name=rec.name,
        host=rec.host,
        port=rec.port,
        username=rec.username,
        auth_mode=rec.auth_mode,
        private_key=rec.private_key,
        private_key_passphrase=rec.private_key_passphrase,
        password=rec.password,
    )
    fac = session_factory()
    async with fac() as session:
        async with session.begin():
            session.add(row)
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
    fac = session_factory()
    async with fac() as session:
        async with session.begin():
            row = await session.get(ServerRow, server_id, with_for_update=True)
            if row is None:
                return None
            row.name = rec.name
            row.host = rec.host
            row.port = rec.port
            row.username = rec.username
            row.auth_mode = rec.auth_mode
            row.private_key = rec.private_key
            row.private_key_passphrase = rec.private_key_passphrase
            row.password = rec.password
    return rec


async def delete_server(server_id: str) -> bool:
    fac = session_factory()
    async with fac() as session:
        async with session.begin():
            res = await session.execute(delete(ServerRow).where(ServerRow.id == server_id))
            return res.rowcount > 0
