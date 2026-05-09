# Plataforma y NFR

## Componentes Plataforma

- API Gateway: auth, rate limit, versioning, request shaping.
- Load Balancer: balanceo L7 y health checks.
- CDN: assets web y proteccion edge.
- Cache Redis: cache, idempotencia, throttling.
- Queue RabbitMQ: jobs ETL, retries, DLQ.
- Event Bus Redpanda: eventos de dominio y analitica.
- Workers: ETL parser, clasificacion IA, exportacion ERP.

## Requerimientos No Funcionales

- Disponibilidad API: 99.9%.
- Disponibilidad pipeline ETL: 99.5%.
- Latencia API: p95 < 350ms en endpoints CRUD.
- Throughput objetivo: 100k facturas/dia fase 2.
- RPO: 15 minutos.
- RTO: 60 minutos.
- Cobertura de tests minima: 80%.

## Escalabilidad

- Horizontal Pod Autoscaler para API/Workers.
- Cola desacoplada para absorber picos.
- Particionado por tenant en eventos de alto volumen.

## Compliance

- Habeas Data (Colombia) y GDPR-ready.
- Cifrado en transito (TLS 1.2+) y reposo (KMS).
- Auditoria inmutable de acciones criticas.
