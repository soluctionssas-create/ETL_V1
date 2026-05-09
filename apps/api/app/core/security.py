"""Utilidades de seguridad: hashing y JWT."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


def hash_password(plain: str) -> str:
    """Retorna el bcrypt hash de la contraseña."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verifica plain contra bcrypt hash."""
    return pwd_context.verify(plain, hashed)


def _make_token(
    subject: str,
    token_type: str,
    extra: dict[str, Any],
    expires_delta: timedelta,
) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": subject,
        "type": token_type,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + expires_delta,
        **extra,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def create_access_token(
    user_id: str,
    tenant_id: str,
    role: str,
    email: str,
) -> str:
    return _make_token(
        subject=user_id,
        token_type="access",
        extra={"tenant_id": tenant_id, "role": role, "email": email},
        expires_delta=timedelta(minutes=settings.jwt_access_expire_minutes),
    )


def create_refresh_token(user_id: str) -> str:
    return _make_token(
        subject=user_id,
        token_type="refresh",
        extra={},
        expires_delta=timedelta(days=settings.jwt_refresh_expire_days),
    )


def decode_token(token: str) -> dict[str, Any]:
    """Decodifica y valida el token. Lanza jwt.ExpiredSignatureError o jwt.InvalidTokenError."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
