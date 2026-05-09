"""Tests de cifrado y tokens."""
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
import jwt
import pytest


def test_password_hash_and_verify():
    plain = "MyStr0ngPass!"
    hashed = hash_password(plain)
    assert hashed != plain
    assert verify_password(plain, hashed)
    assert not verify_password("WrongPass", hashed)


def test_access_token_contains_claims():
    token = create_access_token(
        user_id="user-001",
        tenant_id="tenant-001",
        role="admin",
        email="admin@test.com",
    )
    payload = decode_token(token)
    assert payload["sub"] == "user-001"
    assert payload["tenant_id"] == "tenant-001"
    assert payload["role"] == "admin"
    assert payload["type"] == "access"
    assert "jti" in payload


def test_refresh_token_type():
    token = create_refresh_token(user_id="user-001")
    payload = decode_token(token)
    assert payload["type"] == "refresh"
    assert payload["sub"] == "user-001"


def test_access_token_and_refresh_have_different_types():
    access = create_access_token("u", "t", "operator", "e@e.com")
    refresh = create_refresh_token("u")
    assert decode_token(access)["type"] == "access"
    assert decode_token(refresh)["type"] == "refresh"


def test_invalid_token_raises():
    with pytest.raises(jwt.InvalidTokenError):
        decode_token("not.a.real.jwt")
