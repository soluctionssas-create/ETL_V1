# Producción — Ejecución SQL Motor Tributario: Resultados

**Proyecto Supabase:** `pvzchcscuqpzuaxbfihh` (producción)
**Fecha de ejecución:** 2025-05-18
**Tarea:** Task 12 — Ejecución controlada de scripts SQL en producción
**Base de validación:** Task 11 + 11.1 (staging `skrjyrnprmoattwlitzs`)

---

## Resumen de Resultados

| Métrica | Esperado | Producción | Estado |
|---------|----------|------------|--------|
| Tablas en schema público | 14 (del sprint) | 15* | ✅ |
| Tablas con RLS habilitado | 14/14 | 15/15 | ✅ |
| Políticas RLS totales | 37+ | 40** | ✅ |
| Políticas motor tributario | 22 | 22 | ✅ |
| `tenant_reclassification_audit` | 1 (SELECT only) | 1 (SELECT only) | ✅ |
| Tests Vitest | 141/141 | 141/141 | ✅ |
| Build Next.js | clean | clean (11.8s) | ✅ |

> \* La tabla `todos` preexistía en producción antes de los scripts del sprint.
> \*\* 37 políticas del sprint + 3 políticas preexistentes en `todos`.

---

## Scripts Ejecutados (en orden)

### Script 0 — AUTH SETUP (`SUPABASE_AUTH_SETUP.md`)
- **Resultado:** `Success. No rows returned` ✅
- **Efecto:** Tablas `tenants`, `users`, `invoices` con RLS y políticas base.

### Script 1 — Core App Tables (`database/supabase_core_app_tables.sql`)
- **Resultado:** `Success. No rows returned` ✅
- **Efecto:** Tabla `batches`; extensión de `invoices` (batch_id, vendor_name, vendor_tax_id, total_amount, tax_amount, status).

### Script 2 — Facturación DIAN (`database/supabase_facturacion_dian_es.sql`)
- **Resultado:** `Success. No rows returned` ✅
- **Efecto:** Tablas `facturas_dian`, `facturas_dian_detalle`; trigger `fn_set_actualizado_en`.

### Script 3 — Batches Tenant Migration (`database/supabase_batches_tenant_migration.sql`)
- **Resultado:** `20 rows` ✅ (esperado — backfill de batches existentes con tenant_id = NULL)
- **Efecto:** Columna `tenant_id` en `batches`; FK `fk_batches_tenant_id → tenants(id)`.
- **Nota:** Los 20 registros representan batches preexistentes en producción. El backfill de `tenant_id` es manual por diseño del script.

### Script 4 — Tax Calculation Results (`database/supabase_tax_calculation_results.sql`)
- **Resultado:** `Success. No rows returned` ✅
- **Efecto:** Tablas `invoice_tax_calculations`, `invoice_tax_calculation_groups`, `invoice_line_classifications`; trigger `trg_itc_updated_at`; índices compuestos.

### Script 5 — Tenant Memory (`database/supabase_tenant_memory.sql`)
- **Resultado:** `Success. No rows returned` ✅
- **Efecto:** Tablas `tenant_supplier_memory`, `tenant_accounting_patterns`, `tenant_reclassification_audit`, `accounting_movements_import`, `tenant_tax_classification_memory`; columnas adicionales en `tenant_supplier_memory` y `tenant_reclassification_audit`.

### Script 6A — RLS Políticas (líneas 1-237) (`database/supabase_rls_policies.sql`)
- **Resultado:** `Success. No rows returned` ✅
- **Efecto:** Función `get_tenant_id()`; RLS para `batches`, `invoices`, `facturas_dian`, `facturas_dian_detalle`; habilitación de RLS en `tenants` y `users`.
- **Nota técnica:** Script dividido en 6A+6B por limitación de Monaco Editor (~400 líneas máx).

### Script 6B — RLS Políticas Motor Tributario (líneas 238-470) (`database/supabase_rls_policies.sql`)
- **Resultado:** `Success. No rows returned` ✅
- **Efecto:** RLS habilitado + 3 políticas (SELECT/INSERT/UPDATE) para 7 tablas del motor tributario; 1 política (SELECT only) para `tenant_reclassification_audit`.

---

## Verificación Post-Ejecución

### Tablas en Schema Público (15 total)

```
accounting_movements_import  | RLS: true
batches                      | RLS: true
facturas_dian                | RLS: true
facturas_dian_detalle        | RLS: true
invoice_line_classifications | RLS: true
invoice_tax_calculation_groups | RLS: true
invoice_tax_calculations     | RLS: true
invoices                     | RLS: true
tenant_accounting_patterns   | RLS: true
tenant_reclassification_audit| RLS: true
tenant_supplier_memory       | RLS: true
tenant_tax_classification_memory | RLS: true
tenants                      | RLS: true
todos                        | RLS: true  ← preexistente
users                        | RLS: true
```

### Políticas RLS por Tabla del Sprint (37 políticas)

| Tabla | Políticas | Detalle |
|-------|-----------|---------|
| `tenants` | 2 | SELECT, INSERT |
| `users` | 2 | SELECT, INSERT |
| `invoices` | 3 | SELECT, INSERT, UPDATE |
| `batches` | 3 | SELECT, INSERT, UPDATE |
| `facturas_dian` | 3 | SELECT, INSERT, UPDATE |
| `facturas_dian_detalle` | 3 | SELECT (JOIN EXISTS) |
| `invoice_tax_calculations` | 3 | SELECT, INSERT, UPDATE |
| `invoice_line_classifications` | 3 | SELECT, INSERT, UPDATE |
| `invoice_tax_calculation_groups` | 3 | SELECT, INSERT, UPDATE |
| `tenant_supplier_memory` | 3 | SELECT, INSERT, UPDATE |
| `tenant_tax_classification_memory` | 3 | SELECT, INSERT, UPDATE |
| `tenant_reclassification_audit` | **1** | **SELECT only** |
| `tenant_accounting_patterns` | 3 | SELECT, INSERT, UPDATE |
| `accounting_movements_import` | 3 | SELECT, INSERT, UPDATE |
| **Total** | **37** | |

### Motor Tributario (8 tablas, 22 políticas)

```sql
-- Query de verificación ejecutada:
SELECT COUNT(*) FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN (
  'invoice_tax_calculations','invoice_line_classifications',
  'invoice_tax_calculation_groups','tenant_supplier_memory',
  'tenant_tax_classification_memory','tenant_reclassification_audit',
  'tenant_accounting_patterns','accounting_movements_import'
);
-- Resultado: 22 ✅
```

### `tenant_reclassification_audit` — Solo SELECT para authenticated

```sql
-- Query de verificación ejecutada:
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename='tenant_reclassification_audit';
-- Resultado: tra_select_own_tenant [SELECT] — 1 política ✅
```

INSERT y UPDATE solo accesibles por `service_role` (sin política = solo service_role por diseño).

---

## Tests y Build

### Vitest — 141/141 tests pasando

```
Test Files  8 passed (8)
     Tests  141 passed (141)
  Duration  2.76s
```

### Next.js Build — Compilación exitosa

```
✓ Compiled successfully in 11.8s
```

Páginas compiladas: `/audit`, `/classification`, `/dashboard`, `/exports`, `/invoices`, `/invoices/[batchId]`, `/login`, `/parametrizacion`, `/register`.

---

## Diferencias vs Staging

| Aspecto | Staging | Producción | Explicación |
|---------|---------|------------|-------------|
| Total tablas | 14 | 15 | `todos` preexistía en producción |
| Total políticas | 37 | 40 | 3 políticas preexistentes en `todos` |
| Motor tributario | 22 | 22 | Idéntico ✅ |
| `tenant_reclassification_audit` | 1 SELECT | 1 SELECT | Idéntico ✅ |
| Script 3 resultado | No rows | 20 rows | Batches preexistentes en producción (backfill manual) |

Las diferencias son explicables por el estado previo de producción — no representan inconsistencias.

---

## Notas Técnicas

### Limitación Monaco Editor
El archivo `supabase_rls_policies.sql` (497 líneas) se ejecutó en dos bloques:
- **6A:** Líneas 1-237 (4,412 chars) — función `get_tenant_id()` + RLS tablas core
- **6B:** Líneas 238-470 (6,621 chars) — RLS motor tributario

Patrón confirmado en staging y reproducido exitosamente en producción.

### Backfill Tenant ID en Batches
Los 20 registros devueltos por Script 3 son batches preexistentes con `tenant_id = NULL`. El script expone estos registros como output esperado. El backfill es responsabilidad del proceso operativo (fuera del alcance de Task 12).

---

## Autorización

La ejecución fue autorizada explícitamente por el usuario:
> "Autorizo ejecutar los scripts SQL en producción `pvzchcscuqpzuaxbfihh`, siguiendo exactamente lo validado en staging `skrjyrnprmoattwlitzs`."

Restricciones observadas durante toda la ejecución:
- ⛔ Sin `git push`
- ⛔ Sin deploy a Vercel en producción
- ⛔ Sin modificar credenciales
- ✅ Scripts ejecutados en orden estricto: 0, 1, 2, 3, 4, 5, 6A, 6B
