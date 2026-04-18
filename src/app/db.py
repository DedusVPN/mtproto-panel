from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.db_settings import get_database_settings


class Base(DeclarativeBase):
    pass


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    if _engine is None:
        raise RuntimeError("База данных не инициализирована: вызовите init_db() при старте приложения")
    return _engine


def session_factory() -> async_sessionmaker[AsyncSession]:
    if _session_factory is None:
        raise RuntimeError("База данных не инициализирована: вызовите init_db() при старте приложения")
    return _session_factory


async def init_db() -> None:
    global _engine, _session_factory
    if _engine is not None:
        return
    url = get_database_settings().database_url
    if not url.strip():
        raise RuntimeError("Переменная окружения DATABASE_URL не задана")
    _engine = create_async_engine(
        url,
        pool_pre_ping=True,
    )
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def close_db() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


@asynccontextmanager
async def db_session() -> AsyncIterator[AsyncSession]:
    fac = session_factory()
    async with fac() as session:
        yield session
