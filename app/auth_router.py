from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.auth_passwords import verify_admin_password
from app.auth_tokens import create_access_token
from app.panel_auth_settings import PanelAuthSettings, get_panel_auth_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=512)


class AuthStatusResponse(BaseModel):
    auth_required: bool
    auth_enabled: bool
    admin_username: str


class MeResponse(BaseModel):
    sub: str


def _cookie_params(settings: PanelAuthSettings, request: Request) -> dict[str, str | bool | int]:
    from app.panel_auth_settings import forwarded_https_request

    proto = request.headers.get("x-forwarded-proto")
    secure = settings.cookie_secure
    if settings.trust_forwarded_proto and forwarded_https_request(request.url.scheme, proto):
        secure = True
    same_site = settings.cookie_samesite.lower()
    if same_site == "none" and not secure:
        same_site = "lax"
    return {
        "httponly": True,
        "secure": secure,
        "samesite": same_site,
        "path": "/",
        "max_age": settings.jwt_expire_minutes * 60,
    }


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status() -> AuthStatusResponse:
    s = get_panel_auth_settings()
    active = s.auth_active()
    return AuthStatusResponse(
        auth_required=active,
        auth_enabled=s.auth_enabled,
        admin_username=s.admin_username,
    )


@router.post("/login")
async def login(request: Request, response: Response, body: LoginBody) -> dict[str, str | int]:
    s = get_panel_auth_settings()
    if not s.auth_active():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Аутентификация панели отключена или не настроена",
        )
    if body.username.strip() != s.admin_username.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль")
    ok = verify_admin_password(
        body.password,
        password_hash=s.effective_password_hash(),
        plain_fallback=s.effective_plain_password(),
    )
    if not ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль")

    token, _exp = create_access_token(
        subject=s.admin_username.strip(),
        secret=s.effective_jwt_secret(),
        expires_minutes=s.jwt_expire_minutes,
    )
    cp = _cookie_params(s, request)
    response.set_cookie(s.cookie_name, token, **cp)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": s.jwt_expire_minutes * 60,
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    settings: Annotated[PanelAuthSettings, Depends(get_panel_auth_settings)],
) -> dict[str, bool]:
    """Сбрасывает cookie сессии; не требует валидного JWT (идемпотентно)."""
    cp = _cookie_params(settings, request)
    response.delete_cookie(
        settings.cookie_name,
        path="/",
        secure=bool(cp.get("secure")),
        httponly=True,
        samesite=str(cp["samesite"]),
    )
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
async def me(
    request: Request,
    settings: Annotated[PanelAuthSettings, Depends(get_panel_auth_settings)],
) -> MeResponse:
    from app.auth_http import extract_bearer_token
    from app.auth_tokens import decode_access_token

    if not settings.auth_active():
        return MeResponse(sub="anonymous")
    tok = extract_bearer_token(request, cookie_name=settings.cookie_name)
    if not tok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Не авторизован")
    try:
        payload = decode_access_token(tok, settings.effective_jwt_secret())
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен") from e
    sub = str(payload.get("sub") or "")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")
    return MeResponse(sub=sub)
