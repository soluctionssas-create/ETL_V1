# Resiliencia

- Circuit breaker para ERP adapters.
- Retry strategy exponencial con jitter.
- Dead letter queues por tipo de comando.
- Timeout policies por dependencia externa.
- Idempotencia en mutaciones.
- Graceful degradation de servicios no criticos.
- Health checks y autoself-healing en Kubernetes.

## Continuidad

- Backups automáticos diarios + WAL archiving.
- RPO 15 min, RTO 60 min.
- Replica en region secundaria para DR.
