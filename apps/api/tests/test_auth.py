"""Tests de autenticación: register, login, me, refresh."""
from __future__ import annotations

import pytest


REGISTER_PAYLOAD = {
    "email": "admin@testcorp.com",
    "password": "TestPass1234",
    "full_name": "Admin Test",
    "tenant_slug": "testcorp",
    "tenant_name": "Test Corp S.A.S",
}


def test_register_creates_tenant_and_user(client):
    res = client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["email"] == REGISTER_PAYLOAD["email"]
    assert data["role"] == "admin"
    assert "hashed_password" not in data


def test_register_duplicate_slug_fails(client):
    # Primer registro
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    # Segundo con mismo slug
    res = client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    assert res.status_code == 409


def test_login_success(client):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    res = client.post("/api/v1/auth/login", json={
        "email": REGISTER_PAYLOAD["email"],
        "password": REGISTER_PAYLOAD["password"],
    })
    assert res.status_code == 200, res.text
    data = res.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] > 0


def test_login_wrong_password(client):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    res = client.post("/api/v1/auth/login", json={
        "email": REGISTER_PAYLOAD["email"],
        "password": "WrongPass999",
    })
    assert res.status_code == 401


def test_login_unknown_email(client):
    res = client.post("/api/v1/auth/login", json={
        "email": "nobody@nowhere.com",
        "password": "Whatever123",
    })
    assert res.status_code == 401


def test_me_requires_auth(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401


def test_me_returns_profile(client):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    login = client.post("/api/v1/auth/login", json={
        "email": REGISTER_PAYLOAD["email"],
        "password": REGISTER_PAYLOAD["password"],
    })
    token = login.json()["access_token"]
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["email"] == REGISTER_PAYLOAD["email"]


def test_refresh_token_rotates(client):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    login = client.post("/api/v1/auth/login", json={
        "email": REGISTER_PAYLOAD["email"],
        "password": REGISTER_PAYLOAD["password"],
    })
    refresh_token = login.json()["refresh_token"]
    res = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    # El nuevo refresh token debe ser diferente
    assert data["refresh_token"] != refresh_token


def test_refresh_with_access_token_fails(client):
    client.post("/api/v1/auth/register", json=REGISTER_PAYLOAD)
    login = client.post("/api/v1/auth/login", json={
        "email": REGISTER_PAYLOAD["email"],
        "password": REGISTER_PAYLOAD["password"],
    })
    access_token = login.json()["access_token"]
    # Enviar access token como refresh debe fallar
    res = client.post("/api/v1/auth/refresh", json={"refresh_token": access_token})
    assert res.status_code == 401


def test_security_headers_present(client):
    res = client.get("/api/v1/health/live")
    assert "x-content-type-options" in res.headers
    assert "x-frame-options" in res.headers
    assert "x-correlation-id" in res.headers
