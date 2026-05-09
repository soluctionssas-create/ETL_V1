"""Rutas de autenticación con persistencia real."""
from __future__ import annotations

import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, CurrentUser
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.base import get_db
from app.models.tenant import Tenant, TenantStatus, User, UserRole
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserOut,
)

router = APIRouter()


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """Crea tenant + primer usuario admin."""
    existing_tenant = db.query(Tenant).filter(Tenant.slug == payload.tenant_slug).first()
    if existing_tenant:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tenant slug already in use",
        )

    existing_user = (
        db.query(User)
        .join(Tenant)
        .filter(Tenant.slug == payload.tenant_slug, User.email == payload.email)
        .first()
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered in this tenant",
        )

    tenant = Tenant(
        name=payload.tenant_name,
        slug=payload.tenant_slug,
        status=TenantStatus.trial,
    )
    db.add(tenant)
    db.flush()  # obtiene el ID

    user = User(
        tenant_id=tenant.id,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=UserRole.admin,
        is_active=True,
        is_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """Autenticación con email/password. Devuelve access + refresh tokens."""
    user = (
        db.query(User)
        .filter(
            User.email == payload.email,
            User.is_active.is_(True),
            User.is_deleted.is_(False),
        )
        .first()
    )
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    access = create_access_token(
        user_id=str(user.id),
        tenant_id=str(user.tenant_id),
        role=user.role,
        email=user.email,
    )
    refresh = create_refresh_token(user_id=str(user.id))

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.jwt_access_expire_minutes * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(payload: RefreshRequest, db: Session = Depends(get_db)):
    """Rota access token usando refresh token."""
    try:
        data = decode_token(payload.refresh_token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    if data.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a refresh token")

    user = db.query(User).filter(
        User.id == uuid.UUID(data["sub"]),
        User.is_active.is_(True),
        User.is_deleted.is_(False),
    ).first()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    access = create_access_token(
        user_id=str(user.id),
        tenant_id=str(user.tenant_id),
        role=user.role,
        email=user.email,
    )
    new_refresh = create_refresh_token(user_id=str(user.id))

    return TokenResponse(
        access_token=access,
        refresh_token=new_refresh,
        expires_in=settings.jwt_access_expire_minutes * 60,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(current_user: CurrentUser = Depends(get_current_user)):
    """Logout stateless. El cliente elimina los tokens localmente."""
    return None


@router.get("/me", response_model=UserOut)
def me(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retorna el perfil del usuario autenticado."""
    user = db.query(User).filter(User.id == current_user.user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cambia la contraseña del usuario autenticado."""
    user = db.query(User).filter(User.id == current_user.user_id).first()
    if user is None or not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return None

