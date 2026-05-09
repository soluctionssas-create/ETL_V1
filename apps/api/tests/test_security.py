"""Tests de seguridad: OWASP y RBAC."""


def test_protected_endpoint_no_token(client):
    res = client.get("/api/v1/invoices/batches")
    assert res.status_code == 401


def test_protected_endpoint_invalid_token(client):
    res = client.get(
        "/api/v1/invoices/batches",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert res.status_code == 401


def test_protected_endpoint_expired_token(client):
    """Simula un JWT expirado."""
    import jwt
    import datetime

    expired_token = jwt.encode(
        {
            "sub": "00000000-0000-0000-0000-000000000001",
            "type": "access",
            "exp": datetime.datetime(2020, 1, 1),
        },
        "change-this-super-secret-key-in-production",
        algorithm="HS256",
    )
    res = client.get(
        "/api/v1/invoices/batches",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert res.status_code == 401


def test_sql_injection_in_login(client):
    """Verifica que las validaciones Pydantic previenen SQL injection."""
    res = client.post("/api/v1/auth/login", json={
        "email": "' OR '1'='1",
        "password": "anything",
    })
    # Pydantic rechaza el email inválido con 422
    assert res.status_code == 422


def test_weak_password_rejected(client):
    """Contraseñas débiles deben ser rechazadas en el registro."""
    res = client.post("/api/v1/auth/register", json={
        "email": "test@test.com",
        "password": "short",
        "full_name": "Test User",
        "tenant_slug": "test-tenant",
        "tenant_name": "Test Tenant",
    })
    assert res.status_code == 422
