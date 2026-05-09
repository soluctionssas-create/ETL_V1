# ADR-0001: Monolito Modular Event-Driven

## Estado

Aceptado

## Contexto

El producto requiere salida a produccion rapida, multi-tenant, alta trazabilidad, automatizacion ETL y capacidad de escalar a enterprise.

## Decision

Adoptar monolito modular con DDD, clean architecture y procesamiento event-driven.

Decisiones anexas:

- Shared DB con `tenant_id` + RLS.
- RabbitMQ para comandos asinc.
- Redpanda/Kafka para eventos.
- Outbox pattern para consistencia.
- API REST OpenAPI-first versionada.

## Consecuencias

- Positivo: entrega mas rapida y menor complejidad inicial.
- Positivo: evolucion clara a microservicios por bounded context.
- Negativo: requiere disciplina de fronteras de dominio para evitar acoplamiento.
