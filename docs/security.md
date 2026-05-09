# Seguridad

## Baseline OWASP

- Validacion estricta de entrada.
- Sanitizacion y encoding de salida.
- Rate limiting por tenant/ip.
- Helmet/CSP/CORS en gateway y frontend.
- JWT corto + refresh rotado.

## DevSecOps

- SAST: Semgrep/SonarQube.
- Dependency scanning: Snyk/GitHub Dependabot.
- DAST: OWASP ZAP.
- Container scanning: Trivy.
- IaC scanning: Checkov.
- SBOM: Syft.

## Seguridad avanzada

- Zero Trust para workloads.
- WAF y SIEM integration.
- Secrets rotation y vault.
- Firmado de artefactos y provenance.
