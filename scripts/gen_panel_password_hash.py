#!/usr/bin/env python3
"""Генерация bcrypt-хэша для PANEL_ADMIN_PASSWORD_HASH (аргумент — пароль)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.auth_passwords import hash_password_bcrypt


def main() -> int:
    p = argparse.ArgumentParser(description="bcrypt-хэш пароля панели (stdout).")
    p.add_argument("password", nargs="?", help="Пароль; если не задан — читается из stdin без эха (Unix).")
    args = p.parse_args()
    pw: str
    if args.password is not None:
        pw = args.password
    else:
        try:
            import getpass

            pw = getpass.getpass("Пароль: ")
        except Exception:
            print("Укажите пароль аргументом или введите через stdin.", file=sys.stderr)
            return 2
    if not pw:
        print("Пустой пароль не допускается.", file=sys.stderr)
        return 2
    print(hash_password_bcrypt(pw), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
