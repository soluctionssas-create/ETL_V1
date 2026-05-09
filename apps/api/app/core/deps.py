"""Dependencias FastAPI para autenticación y autorización RBAC."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Callable

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.base import get_db
from app.models.tenant import User, UserRole

bearer_scheme = HTTPBearer(auto_error=False)

ROLE_ORDER = {
    UserRole.viewer: 0,
    UserRole.operator: 1,
    UserRole.admin: 2,
    UserRole.superadmin: 3,
}


@dataclass
class CurrentUser:
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    role: str


def _extract_token(
    credentials: HTTPAuthorizationCredentials | None,
) -> str:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No authentication token provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    token = _extract_token(credentials)
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Expected access token",
        )

    user = db.query(User).filter(
        User.id == uuid.UUID(payload["sub"]),
        User.is_active.is_(True),
        User.is_deleted.is_(False),
    ).first()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return CurrentUser(
        user_id=user.id,
        tenant_id=user.tenant_id,
        email=user.email,
        role=user.role,
    )


def require_role(minimum_role: UserRole) -> Callable:
    """Factory: devuelve una dependencia que exige un rol mínimo."""
    def _check(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        user_level = ROLE_ORDER.get(UserRole(current_user.role), -1)
        required_level = ROLE_ORDER[minimum_role]
        if user_level < required_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{minimum_role.value}' or above required",
            )
        return current_user

    return _check


# Atajos predefinidos
require_viewer = require_role(UserRole.viewer)
require_operator = require_role(UserRole.operator)
require_admin = require_role(UserRole.admin)
require_superadmin = require_role(UserRole.superadmin)
