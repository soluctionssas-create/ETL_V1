# Estrategia de Testing

Cobertura minima objetivo: 80% backend y frontend.

## Piramide de pruebas

- Unit: logica de negocio, validaciones, mappers.
- Integration: API + DB + cola (testcontainers).
- E2E: flujos criticos (upload -> clasificacion -> export).
- Contract testing: OpenAPI/Pact para integraciones ERP.
- Performance: k6 (load, stress, spike, soak).
- Security: OWASP ZAP + Snyk.

## Suites avanzadas

- Smoke y regression por cada release.
- Mutation testing en reglas contables.
- Chaos testing en entorno staging.
- Accessibility y visual regression para frontend.

## Pipeline QA

1. Lint + type check.
2. Unit + integration.
3. Build artifacts.
4. E2E en ambiente efimero.
5. Scanners de seguridad.
6. Gate de cobertura y quality gate.
