# ETL Contable SaaS

Plataforma SaaS B2B para procesamiento de facturas (PDF/XML/ZIP), extraccion de datos contables, clasificacion con IA por empresa y exportacion a ERP.

## Objetivo

- Reducir digitacion manual y errores contables.
- Estandarizar reglas por tenant (empresa cliente).
- Acelerar cierres operativos.

## Arquitectura Elegida

- Estilo: monolito modular + arquitectura hexagonal + orientada a eventos.
- Patrons: outbox, idempotencia, correlation id, retries con DLQ.
- Estrategia de evolucion: modular monolith -> microservicios por bounded context al escalar.

Detalles en:

- docs/architecture/01-enterprise-architecture.md
- docs/architecture/02-diagrams.md
- docs/architecture/03-platform-nfr.md

## Stack Recomendado

- Frontend: Next.js 15 + TypeScript + Tailwind + TanStack Query.
- Backend: FastAPI + SQLAlchemy + Alembic + Pydantic v2.
- Jobs: Celery + RabbitMQ.
- Datos: PostgreSQL 16 + Redis.
- Event Bus: Redpanda (Kafka API compatible).
- Observabilidad: OpenTelemetry + Prometheus + Grafana + Loki.
- DevOps: Docker + Kubernetes + Terraform + GitHub Actions.

## Estructura

- apps/web: panel administrativo.
- apps/api: API REST multi-tenant.
- apps/worker: procesamiento ETL/IA/exportacion.
- packages/contracts: contratos de eventos y API.
- infra: docker, kubernetes, terraform, helm.
- docs: arquitectura, ADR, API, roadmap, runbooks.
- tests: unit, integration, e2e, performance.

## Quick Start (desarrollo)

1. Copiar variables:
   - cp .env.example .env
2. Levantar servicios base:
   - docker compose up -d postgres redis rabbitmq redpanda
3. API:
   - cd apps/api
   - pip install -r requirements.txt
   - uvicorn app.main:app --reload --port 8000
4. Worker:
   - cd apps/worker
   - pip install -r requirements.txt
   - celery -A worker.celery_app worker --loglevel=info
5. Web:
   - cd apps/web
   - npm install
   - npm run dev

## Seguridad

- OWASP Top 10 aplicado en gateway y API.
- JWT/OIDC, RBAC y politicas por tenant.
- Rate limiting, CSP, CORS, validacion estricta de entrada.
- Secrets en gestor centralizado (Vault/Secrets Manager).

## Entregables incluidos en este bootstrap

- Arquitectura y ADR iniciales.
- Backend modular base con endpoints v1.
- Frontend base con panel y rutas principales.
- Scripts SQL y esquema inicial multi-tenant.
- Docker Compose, manifiestos Kubernetes y pipeline CI.
- Estrategia de testing, observabilidad y roadmap por fases.
