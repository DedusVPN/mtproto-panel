from __future__ import annotations

import hashlib
import hmac

import bcrypt


def verify_admin_password(
    password: str,
    *,
    password_hash: str,
    plain_fallback: str,
) -> bool:
    """
    Проверка пароля: предпочтительно bcrypt-хэш; иначе сравнение с plain_fallback (SHA-256 + compare_digest).
    """
    pw = password or ""
    h = (password_hash or "").strip()
    if h:
        try:
            return bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))
        except ValueError:
            return False
    fb = plain_fallback or ""
    if not fb:
        return False

    def digest(s: str) -> bytes:
        return hashlib.sha256(s.encode("utf-8")).digest()

    return hmac.compare_digest(digest(pw), digest(fb))


def hash_password_bcrypt(password: str, *, rounds: int = 12) -> str:
    salt = bcrypt.gensalt(rounds=rounds)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("ascii")
