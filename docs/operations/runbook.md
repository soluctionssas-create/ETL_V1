# Runbook Operativo

## SLAs iniciales

- P1: respuesta < 15 min, mitigacion < 60 min.
- P2: respuesta < 1 h, mitigacion < 4 h.

## On-call

- Rotacion semanal (backend/devops).
- Escalacion a security/compliance cuando aplica.

## Incidentes

1. Detectar via alertas.
2. Clasificar severidad.
3. Mitigar y comunicar estado.
4. Ejecutar postmortem sin culpa en < 48 h.

## Operaciones comunes

- Reiniciar worker saturado.
- Reprocesar lote fallido.
- Rotar credenciales.
- Restaurar backup de tenant.
