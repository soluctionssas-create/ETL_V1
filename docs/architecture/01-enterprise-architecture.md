# Arquitectura Enterprise

## 1. Decision Arquitectonica

Se adopta arquitectura **monolito modular** con enfoque **hexagonal + clean architecture**, procesamiento **event-driven** y camino de evolucion a microservicios.

### Por que esta opcion

- Menor complejidad inicial que microservicios puros.
- Permite escalar horizontalmente desde fase MVP.
- Separa claramente dominios (DDD) para extraer servicios despues.
- Reduce acoplamiento usando eventos, outbox y contratos.

## 2. Bounded Contexts (DDD)

- Identity & Access
- Tenant Management
- Ingestion (upload y normalizacion)
- Extraction (OCR/XML parser)
- Classification (reglas + IA)
- Accounting Export (ERP adapters)
- Billing & Subscription
- Audit & Compliance

## 3. Estilo por capas (Hexagonal)

- Domain: entidades, value objects, reglas de negocio.
- Application: casos de uso, orquestacion y comandos.
- Adapters Inbound: REST API, webhooks, eventos.
- Adapters Outbound: DB, cola, event bus, storage, ERP.

## 4. Topologia cloud

- Edge: CDN + WAF + API Gateway.
- Compute: API pods + worker pods en Kubernetes.
- Data: PostgreSQL + Redis + Object Storage.
- Messaging: RabbitMQ (comandos) + Redpanda/Kafka (eventos).
- Observabilidad: OTel Collector + Prometheus + Grafana + Loki.

## 5. Multi-tenant

Modelo recomendado: **shared database, shared schema** con `tenant_id` en todas las tablas de negocio y Row Level Security por tenant en PostgreSQL.

Evolucion posible:

- Tier enterprise: esquema por tenant o DB por tenant para aislamiento fuerte.

## 6. API-first

- Contrato OpenAPI versionado (`/api/v1`).
- Compatibilidad hacia atras en cambios menores.
- Version bump para breaking changes.

## 7. Resiliencia

- Retry exponencial con jitter.
- DLQ por tipo de job.
- Timeouts y circuit breaker hacia ERPs externos.
- Idempotencia en uploads, clasificacion y exportacion.

## 8. Seguridad avanzada

- Zero Trust interno por identidad de workload.
- JWT/OIDC + RBAC + politicas por recurso.
- Secret rotation + KMS.
- SAST/DAST/Container/IaC scanning en CI.
