#!/usr/bin/env python3
"""Ручное слияние JSON из каталога data/ в PostgreSQL (upsert, метрики без дублей).

Для автоматического переноса при обновлении Docker см. entrypoint и `app.legacy_data_import`.

    uv run python scripts/migrate_json_to_postgres.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]


async def main() -> None:
    from app.db import close_db, init_db
    from app.db_settings import get_database_settings
    from app.legacy_data_import import migrate_legacy_json_merge, resolve_legacy_data_dir

    _ = get_database_settings()
    await init_db()
    d = resolve_legacy_data_dir()
    if d is None:
        d = _REPO / "data"
    if not d.is_dir():
        print("Каталог с JSON не найден (data/ или LEGACY_DATA_DIR)", file=sys.stderr)
        await close_db()
        sys.exit(1)
    try:
        await migrate_legacy_json_merge(d)
    finally:
        await close_db()
    print("Готово:", d)


if __name__ == "__main__":
    sys.path.insert(0, str(_REPO / "src"))
    asyncio.run(main())
