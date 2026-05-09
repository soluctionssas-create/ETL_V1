# Observabilidad

## Logs

- JSON estructurado con `tenant_id`, `correlation_id`, `user_id`.
- Redaction de PII en logging pipeline.

## Metrics

- API latency p50/p95/p99.
- Queue depth y retry rate.
- Job success ratio por tenant.
- Error budget burn rate.

## Tracing

- OpenTelemetry end-to-end.
- Propagacion de trace/correlation id API -> worker -> ERP.

## Alertas

- SLA/SLO breach.
- cola saturada.
- error 5xx anomalo.
- fallas de exportacion ERP.
