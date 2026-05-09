# API v1 - Endpoints

Base URL: `/api/v1`

## Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/verify-email`

## Tenants

- `GET /tenants`
- `POST /tenants`
- `GET /tenants/{tenant_id}`
- `PATCH /tenants/{tenant_id}`
- `DELETE /tenants/{tenant_id}`

## Invoices & ETL

- `POST /invoices/upload` (multipart)
- `GET /invoices`
- `GET /invoices/{invoice_id}`
- `POST /invoices/{invoice_id}/reprocess`
- `GET /batches/{batch_id}`

## Classification

- `GET /classifications`
- `PATCH /classifications/{id}`
- `POST /classifications/{id}/approve`
- `POST /classification-rules`

## ERP Export

- `POST /exports/run`
- `GET /exports`
- `GET /exports/{export_id}`
- `POST /exports/{export_id}/retry`

## Audit & Monitoring

- `GET /audit/events`
- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

## Estandares de respuesta

- `200` ok sync.
- `201` creado.
- `202` job aceptado.
- `400` validacion.
- `401` no autenticado.
- `403` no autorizado.
- `404` no encontrado.
- `409` conflicto/idempotencia.
- `422` regla de negocio.
- `429` rate limit.
- `500` error interno.

Headers:

- `Authorization: Bearer <token>`
- `X-Tenant-Id: <uuid>`
- `X-Correlation-Id: <uuid>`
- `X-Idempotency-Key: <uuid>` (mutaciones criticas)
