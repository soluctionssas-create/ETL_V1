# Governance

## Estándares de desarrollo

- Clean code + SOLID + DRY.
- API-first y contratos versionados.
- ADR obligatorio para decisiones estructurales.

## Git y flujo

- Estrategia recomendada: trunk-based con feature branches cortas.
- Conventional commits.
- Pull requests con al menos 1 aprobacion.

## Quality gates

- Lint, tests, coverage >= 80%.
- SonarQube quality gate.
- Scans de seguridad sin vulnerabilidades criticas abiertas.

## Technical debt

- Registro explicito por sprint.
- Clasificacion: seguridad, performance, mantenibilidad.
- SLO de cierre de deuda critica.
