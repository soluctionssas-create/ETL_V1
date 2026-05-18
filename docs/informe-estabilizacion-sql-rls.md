# Informe Estabilización SQL/RLS Motor Tributario ETL_V1

**Fecha:** 2026-05-18  
**Fase:** Estabilización pre-producción  
**Sprint base:** Motor Tributario (Tasks 1-8)  
**Commit local:** `ecac162`  
**Estado:** Listo para revisión antes de ejecución en Supabase

---

## 1. Resumen Ejecutivo

Se completó la fase de estabilización SQL/RLS del motor tributario del ETL_V1. Los
hallazgos pendientes del SQL review (Task 7) fueron resueltos en su totalidad:
columnas FK faltantes añadidas, índices compuestos tenant-aware creados, RLS habilitada
y policies definidas para las 8 tablas del motor tributario, tablas futuras documentadas
con COMMENT, y los routes de Next.js actualizados para persistir las FKs recién definidas.

**Resultado de validación local:**
- Tests: **141/141 passing** (sin regresiones)
- Build: **✓ Compiled successfully** (TypeScript strict, sin errores)
- Commit local: `ecac162` en rama `main` (NO pushed, NO deployed)

---

## 2. Issues del SQL Review Corregidos

| ID | Severidad | Descripción | Estado |
|----|-----------|-------------|--------|
| ISSUE-1 | 🟡 Medio | `invoice_line_classifications` definida pero no poblada | ✅ Documentada como tabla futura con COMMENT SQL + RLS habilitada |
| ISSUE-2 | 🟡 Medio | `invoice_tax_calculation_groups` posiblemente inactiva | ✅ Documentada como tabla futura con COMMENT SQL + RLS habilitada |
| ISSUE-3 | 🟡 Medio | RLS ausente en tablas del motor tributario | ✅ RLS + policies añadidas para 8 tablas |
| OBS-2 | 🟢 Baja | Índice compuesto `(tenant_id, invoice_number)` faltante | ✅ 5 índices compuestos tenant-aware creados |
| NUEVO | 🟡 Medio | `invoice_id` y `factura_dian_id` faltaban en `invoice_tax_calculations` | ✅ Columnas añadidas vía `ADD COLUMN IF NOT EXISTS` |
| NUEVO | 🟡 Medio | Routes no persistían `invoice_id`/`factura_dian_id` | ✅ `batches/route.ts` y `SELECT_FIELDS` actualizados |

---

## 3. Issues Que Quedan Pendientes

| ID | Severidad | Descripción | Mitigación Actual |
|----|-----------|-------------|-------------------|
| OBS-3 | 🟢 Baja | FK `line_classification_id` en audit apunta a tabla vacía (nullable) | Nullable → no rompe funcionalidad |
| OBS-5 | 🟢 Baja | Columnas legacy `field_changed`/`old_value`/`new_value` en audit coexisten con nuevas | Columnas legacy quedan como fallback; nuevas (`field_name`, `old_value_json`, etc.) son las activas |
| FUTURO | ⚪ Informativo | `invoice_line_classifications` y `invoice_tax_calculation_groups` no se pueblan | Requieren pipeline de migración de JSONB → filas normalizadas; sprint futuro |
| FUTURO | ⚪ Informativo | Recálculo automático post-reclasificación no implementado | Sprint siguiente |
| FUTURO | ⚪ Informativo | Tests de integración de routes (mocks Supabase vía msw/nock) | Sprint siguiente |
| BLOQUEANTE | ✅ Resuelto | Proyecto Supabase staging creado (`etl-v1-staging` / `skrjyrnprmoattwlitzs`) — 7 scripts SQL ejecutados, 14 tablas verificadas, 37 políticas RLS, seed mínimo validado | Task 11 + 11.1 completadas — ver `docs/staging-ejecucion-sql-motor-tributario-resultados.md` |
| RLS-DISCREPANCIA | ✅ Resuelto | 8 tablas motor tributario tenían `rls_enabled = false` en staging tras Task 11 (script largo truncado en Monaco) | Task 11.1: patch ejecutado, 14/14 tablas con RLS, 37 policies totales |

---

## 4. Tablas Revisadas

| Tabla | Archivo SQL | Estado RLS | Poblada actualmente |
|-------|-------------|-----------|---------------------|
| `invoice_tax_calculations` | `supabase_tax_calculation_results.sql` | ✅ ENABLED | ✅ Sí (por `batches/route.ts`) |
| `invoice_line_classifications` | `supabase_tax_calculation_results.sql` | ✅ ENABLED | ⚪ No — tabla futura |
| `invoice_tax_calculation_groups` | `supabase_tax_calculation_results.sql` | ✅ ENABLED | ⚪ No — tabla futura |
| `tenant_supplier_memory` | `supabase_tenant_memory.sql` | ✅ ENABLED | ✅ Sí (por routes reclassify) |
| `tenant_tax_classification_memory` | `supabase_tenant_memory.sql` | ✅ ENABLED | ✅ Sí (por routes reclassify) |
| `tenant_reclassification_audit` | `supabase_tenant_memory.sql` | ✅ ENABLED | ✅ Sí (por routes reclassify) |
| `tenant_accounting_patterns` | `supabase_tenant_memory.sql` | ✅ ENABLED | ⚪ No — importación futura |
| `accounting_movements_import` | `supabase_tenant_memory.sql` | ✅ ENABLED | ⚪ No — importación futura |

---

## 5. Columnas Agregadas o Confirmadas

### `invoice_tax_calculations` — columnas añadidas en esta fase

```sql
ALTER TABLE public.invoice_tax_calculations
  ADD COLUMN IF NOT EXISTS invoice_id      uuid,
  ADD COLUMN IF NOT EXISTS factura_dian_id uuid;
```

**Contexto:** Las columnas originales (`tenant_id`, `batch_id`, `invoice_number`, etc.) ya
existían en el esquema. Se añadieron las FK de referencia a `invoices` y `facturas_dian`.
No se definen como `REFERENCES` con FK constraint para evitar dependencias de orden de
ejecución en migraciones; la integridad referencial la garantiza el código.

### Columnas ya existentes en el sprint anterior (Task 6)

En `tenant_supplier_memory`:
```sql
ADD COLUMN IF NOT EXISTS source        text
ADD COLUMN IF NOT EXISTS metadata_json jsonb
```

En `tenant_reclassification_audit`:
```sql
ADD COLUMN IF NOT EXISTS invoice_id      uuid
ADD COLUMN IF NOT EXISTS factura_dian_id uuid
ADD COLUMN IF NOT EXISTS line_id         text
ADD COLUMN IF NOT EXISTS supplier_name   text
ADD COLUMN IF NOT EXISTS field_name      text
ADD COLUMN IF NOT EXISTS old_value_json  jsonb
ADD COLUMN IF NOT EXISTS new_value_json  jsonb
```

---

## 6. RLS Habilitada

RLS activada en las siguientes 8 tablas (adicionalmente a las 4 tablas originales que ya
tenían RLS: `batches`, `invoices`, `facturas_dian`, `facturas_dian_detalle`):

```sql
ALTER TABLE public.invoice_tax_calculations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_classifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_tax_calculation_groups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_supplier_memory           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_tax_classification_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_reclassification_audit    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_accounting_patterns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_movements_import      ENABLE ROW LEVEL SECURITY;
```

**Nota:** Los routes de Next.js usan `service_role_key` que bypasa RLS. Las policies
protegen el acceso directo con `anon`/`authenticated` key (dashboard, SDKs de cliente).

---

## 7. Policies Creadas

### Patrón aplicado (idempotente)

```sql
DROP POLICY IF EXISTS "<nombre>" ON public.<tabla>;
CREATE POLICY "<nombre>"
  ON public.<tabla>
  FOR <operacion>
  TO authenticated
  USING (tenant_id = public.get_tenant_id());
```

### Resumen de policies por tabla

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `invoice_tax_calculations` | ✅ `itc_select_own_tenant` | ✅ `itc_insert_own_tenant` | ✅ `itc_update_own_tenant` | Bloqueado |
| `invoice_line_classifications` | ✅ `ilc_select_own_tenant` | ✅ `ilc_insert_own_tenant` | ✅ `ilc_update_own_tenant` | Bloqueado |
| `invoice_tax_calculation_groups` | ✅ `itcg_select_own_tenant` | ✅ `itcg_insert_own_tenant` | ✅ `itcg_update_own_tenant` | Bloqueado |
| `tenant_supplier_memory` | ✅ `tsm_select_own_tenant` | ✅ `tsm_insert_own_tenant` | ✅ `tsm_update_own_tenant` | Bloqueado |
| `tenant_tax_classification_memory` | ✅ `ttcm_select_own_tenant` | ✅ `ttcm_insert_own_tenant` | ✅ `ttcm_update_own_tenant` | Bloqueado |
| `tenant_reclassification_audit` | ✅ `tra_select_own_tenant` | Solo service_role | Solo service_role | Bloqueado |
| `tenant_accounting_patterns` | ✅ `tap_select_own_tenant` | ✅ `tap_insert_own_tenant` | ✅ `tap_update_own_tenant` | Bloqueado |
| `accounting_movements_import` | ✅ `ami_select_own_tenant` | ✅ `ami_insert_own_tenant` | ✅ `ami_update_own_tenant` | Bloqueado |

**Nota `tenant_reclassification_audit`:** Solo SELECT para `authenticated`. INSERT/UPDATE
exclusivamente desde `service_role` (routes backend). Garantiza inmutabilidad del trail
de auditoría desde el cliente.

### Función auxiliar

`public.get_tenant_id()` ya existía en `supabase_rls_policies.sql`. **No se duplicó.**
La función lee `public.users` con `SECURITY DEFINER` y retorna el `tenant_id` del JWT uid.

---

## 8. Índices Agregados

### Nuevos índices en `invoice_tax_calculations`

```sql
-- FKs nuevas
CREATE INDEX IF NOT EXISTS idx_itc_invoice_id
  ON public.invoice_tax_calculations(invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_itc_factura_dian_id
  ON public.invoice_tax_calculations(factura_dian_id)
  WHERE factura_dian_id IS NOT NULL;

-- Compuestos tenant-aware (queries multi-tenant con filtros combinados)
CREATE INDEX IF NOT EXISTS idx_invoice_tax_calculations_tenant_batch
  ON public.invoice_tax_calculations(tenant_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_invoice_tax_calculations_tenant_invoice_number
  ON public.invoice_tax_calculations(tenant_id, invoice_number);

CREATE INDEX IF NOT EXISTS idx_invoice_tax_calculations_tenant_supplier_nit
  ON public.invoice_tax_calculations(tenant_id, supplier_nit);

CREATE INDEX IF NOT EXISTS idx_invoice_tax_calculations_tenant_buyer_nit
  ON public.invoice_tax_calculations(tenant_id, buyer_nit);

CREATE INDEX IF NOT EXISTS idx_invoice_tax_calculations_tenant_requires_review
  ON public.invoice_tax_calculations(tenant_id, requires_review)
  WHERE requires_review = true;
```

### Índices previos (ya existían)

```
idx_itc_tenant_id, idx_itc_batch_id, idx_itc_supplier_nit,
idx_itc_invoice_number, idx_itc_requires_review (sin tenant), idx_itc_result_json_gin
```

---

## 9. Orden de Ejecución SQL Recomendado

Ejecutar en este orden exacto en el SQL Editor de Supabase:

```
1. database/supabase_core_app_tables.sql      (base: users, tenants, batches, invoices)
2. database/supabase_facturacion_dian_es.sql  (facturas_dian, facturas_dian_detalle)
3. database/supabase_tax_calculation_results.sql  (motor: invoice_tax_calculations + tablas futuras)
4. database/supabase_tenant_memory.sql        (memoria: supplier + patterns + audit + classification)
5. database/supabase_rls_policies.sql         (RLS: todas las tablas)
```

**Prerrequisitos por archivo:**
- `supabase_tax_calculation_results.sql` requiere que `supabase_core_app_tables.sql` ya esté ejecutado (usa `public.set_updated_at()`).
- `supabase_rls_policies.sql` requiere que todas las tablas ya existan (usa `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
- Todos los scripts son **idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).

---

## 10. Queries de Verificación Supabase

### Verificar RLS habilitada

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'invoice_tax_calculations',
    'invoice_line_classifications',
    'invoice_tax_calculation_groups',
    'tenant_supplier_memory',
    'tenant_tax_classification_memory',
    'tenant_reclassification_audit',
    'tenant_accounting_patterns',
    'accounting_movements_import'
  )
ORDER BY tablename;
```

**Resultado esperado:** `rowsecurity = true` para todas las filas.

### Verificar policies activas

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'invoice_tax_calculations',
    'invoice_line_classifications',
    'invoice_tax_calculation_groups',
    'tenant_supplier_memory',
    'tenant_tax_classification_memory',
    'tenant_reclassification_audit',
    'tenant_accounting_patterns',
    'accounting_movements_import'
  )
ORDER BY tablename, policyname;
```

**Resultado esperado:** Mínimo 2-3 policies por tabla (SELECT + INSERT + UPDATE, o solo SELECT).

### Verificar columnas de `invoice_tax_calculations`

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'invoice_tax_calculations'
ORDER BY ordinal_position;
```

**Columnas esperadas:** `id`, `tenant_id`, `batch_id`, `invoice_id`, `factura_dian_id`,
`invoice_number`, `supplier_nit`, `supplier_name`, `buyer_nit`, `buyer_name`, `city`,
`subtotal`, `iva_total`, `inc_total`, `total_invoice`, `retefuente_*`, `reteica_*`,
`reteiva_*` (9 columnas), `requires_review`, `warnings_json`, `result_json`,
`created_at`, `updated_at`.

### Verificar índices de `invoice_tax_calculations`

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'invoice_tax_calculations'
ORDER BY indexname;
```

---

## 11. Tests

```
Test Files  8 passed (8)
     Tests  141 passed (141)
  Duration  ~1.8s

✓ __tests__/api/tax-calculations-filters.test.ts (30 tests)
✓ __tests__/tax/reclassification.test.ts (38 tests)
✓ __tests__/tax/reteiva.test.ts (6 tests)
✓ __tests__/tax/retefuente.test.ts (5 tests)
✓ __tests__/tax/reteica.test.ts (8 tests)
✓ __tests__/dian-extraction.test.ts (28 tests)
✓ __tests__/tax/marzo-batch.test.ts (7 tests)
✓ __tests__/tax/factura-grande.test.ts (19 tests)
```

Sin regresiones. Los cambios en `batches/route.ts` y `tax-calculations/route.ts` no
afectan los tests unitarios (los tests no dependen de Supabase).

---

## 12. Build

```
✓ Compiled successfully in 10.7s
  Linting and checking validity of types ...
✓ Generating static pages (17/17)
```

TypeScript strict sin errores. Los cambios al `taxPayload` y `SELECT_FIELDS` no
introducen tipos nuevos incompatibles.

---

## 13. Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `database/supabase_tax_calculation_results.sql` | +60 líneas: `ADD COLUMN invoice_id/factura_dian_id`, 7 índices compuestos, COMMENTs tablas futuras |
| `database/supabase_rls_policies.sql` | +215 líneas: RLS + policies para 8 tablas + queries de verificación |
| `apps/web/app/api/v1/invoices/batches/route.ts` | `taxPayload` incluye `invoice_id: seed.invoiceId` y `factura_dian_id: dianInvoice.id` |
| `apps/web/app/api/v1/invoices/batches/[batchId]/tax-calculations/route.ts` | `SELECT_FIELDS` incluye `invoice_id`, `factura_dian_id`; eliminado comentario "pendiente" |

---

## 14. Commit Local

```
commit ecac162
Author: [usuario]
Date:   2026-05-18

    chore: harden tax engine SQL and RLS policies

    - invoice_tax_calculations: ADD COLUMN invoice_id, factura_dian_id
    - invoice_tax_calculations: 5 composite tenant-aware indexes
    - invoice_line_classifications: RLS + COMMENT (tabla futura)
    - invoice_tax_calculation_groups: RLS + COMMENT (tabla futura)
    - supabase_rls_policies.sql: RLS para 8 tablas del motor tributario
    - batches/route.ts: taxPayload incluye invoice_id y factura_dian_id
    - tax-calculations/route.ts: SELECT_FIELDS incluye invoice_id y factura_dian_id
    - 141/141 tests passing, build limpio

    NO ejecutado en Supabase produccion. NO push. NO deploy.
```

---

## 15. Restricciones Antes de Producción

**NO ejecutar** hasta que el usuario confirme revisión de este informe:

```
❌ git push
❌ npx vercel --prod
❌ Ejecutar SQL en Supabase producción
❌ Ejecutar SQL en Supabase staging sin staging aislado
```

**Checklist pre-producción:**

- [ ] Usuario revisó y aprobó este informe
- [ ] SQL ejecutado en staging siguiendo `docs/runbook-sql-staging-motor-tributario.md`
- [ ] Verificación post-staging: queries de la Sección 10 retornan resultados esperados
- [ ] Smoke tests de la Sección 13 del runbook completados sin errores
- [ ] Decisión tomada sobre `invoice_line_classifications` y `invoice_tax_calculation_groups` (¿sprint futuro de normalización?)
- [ ] `git push` aprobado explícitamente
- [ ] Deploy a Vercel aprobado explícitamente

> **Runbook de staging disponible:** [`docs/runbook-sql-staging-motor-tributario.md`](./runbook-sql-staging-motor-tributario.md) — Contiene el orden exacto de ejecución, queries de verificación por script, 22 verificaciones post-ejecución y criterios de aprobación para producción.

---

## 16. Informe Para ChatGPT

```
CONTEXTO:
Motor tributario ETL_V1 — Next.js 15, Supabase, TypeScript strict.
Fase de estabilización SQL/RLS completada.

ARCHIVOS SQL CRÍTICOS:
- database/supabase_tax_calculation_results.sql (motor: invoice_tax_calculations)
- database/supabase_tenant_memory.sql (memoria: supplier + audit + patterns)
- database/supabase_rls_policies.sql (RLS completo: 12 tablas total)

ESTADO:
- 141/141 tests passing (vitest)
- Build limpio (Next.js 15 TypeScript strict)
- Commit local: ecac162 — NO pushed, NO deployed

COLUMNAS CLAVE invoice_tax_calculations:
id, tenant_id, batch_id, invoice_id (NEW), factura_dian_id (NEW),
invoice_number, supplier_nit, supplier_name, buyer_nit, buyer_name,
city, subtotal, iva_total, inc_total, total_invoice,
retefuente_calculated/reported/difference,
reteica_calculated/reported/difference,
reteiva_calculated/reported/difference,
requires_review, warnings_json, result_json, created_at, updated_at

TABLAS FUTURAS (NO pobladas actualmente):
- invoice_line_classifications → datos de líneas están en result_json JSONB
- invoice_tax_calculation_groups → grupos tributarios están en result_json JSONB

RLS ACTIVA EN 12 TABLAS:
4 originales: batches, invoices, facturas_dian, facturas_dian_detalle
8 nuevas: invoice_tax_calculations, invoice_line_classifications,
          invoice_tax_calculation_groups, tenant_supplier_memory,
          tenant_tax_classification_memory, tenant_reclassification_audit,
          tenant_accounting_patterns, accounting_movements_import

PENDIENTE (requiere decisión):
1. Ejecutar SQL en Supabase (seguir docs/runbook-sql-staging-motor-tributario.md — ya documentado)
2. git push (requiere aprobación explícita)
3. Normalización JSONB → tablas (sprint futuro)
4. Tests de integración con mocks Supabase (sprint futuro)
5. Recálculo automático post-reclasificación (sprint futuro)

RUNBOOK DISPONIBLE:
docs/runbook-sql-staging-motor-tributario.md
- 16 secciones
- Orden exacto de 5 scripts
- Queries verificación post-ejecución por script
- 22 verificaciones de políticas RLS
- 5 smoke tests API
- Criterios de aprobación para producción
```
