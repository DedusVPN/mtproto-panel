from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

JWT_ALGORITHM = "HS256"


def create_access_token(*, subject: str, secret: str, expires_minutes: int) -> tuple[str, datetime]:
    if len(secret) < 32:
        raise ValueError("JWT secret must be at least 32 characters")
    now = datetime.now(tz=UTC)
    exp = now + timedelta(minutes=expires_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": exp,
        "jti": secrets.token_urlsafe(16),
    }
    token = jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)
    if isinstance(token, bytes):
        token = token.decode("ascii")
    return token, exp


def decode_access_token(token: str, secret: str) -> dict[str, Any]:
    return jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
