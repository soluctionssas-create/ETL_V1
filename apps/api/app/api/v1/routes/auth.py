from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

from app.core.config import settings


router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest):
    if not payload.password:
        raise HTTPException(status_code=400, detail="password_required")

    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=settings.jwt_expires_minutes)
    token = jwt.encode(
        {
            "sub": payload.email,
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "exp": exp,
            "roles": ["admin"],
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    return TokenResponse(access_token=token, expires_in=settings.jwt_expires_minutes * 60)


@router.post("/refresh", response_model=TokenResponse)
def refresh():
    return login(LoginRequest(email="demo@demo.com", password="refresh"))


@router.post("/logout")
def logout():
    return {"message": "logout_ok"}
