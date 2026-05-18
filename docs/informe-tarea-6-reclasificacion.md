# Informe Tarea 6 — Reclasificación Manual + Auditoría + Memoria por Tenant
**ETL_V1 · Sprint activo · Estado: ✅ Implementado y verificado**

---

## 1. Resumen Ejecutivo

Se implementó el sistema completo de **reclasificación manual** de facturas DIAN,
incluyendo validación de payloads, actualización de la memoria por proveedor, memoria
por patrón de línea, y auditoría inmutable de cambios campo a campo. El módulo es
multi-tenant, sin SQL crudo y opera directamente sobre el JSONB `result_json` de
`invoice_tax_calculations`.

**Resultado:**
- 38 tests nuevos en `reclassification.test.ts`
- **141/141 tests passing** (8 archivos)
- **Build Next.js limpio** (`✓ Compiled successfully`)
- 0 errores TypeScript (`noUnusedLocals` activo)

---

## 2. Endpoints Implementados

### 2.1 Reclasificación de Factura
```
POST /api/v1/invoices/:invoiceId/reclassify
```
**Archivo:** `apps/web/app/api/v1/invoices/[invoiceId]/reclassify/route.ts`

**Flujo:**
1. Resuelve `tenant_id` + `user_id` desde Bearer token (fallback: single-tenant)
2. Valida payload con `validateInvoiceReclassificationPayload`
3. Busca `invoice_tax_calculations` filtrando por `tenant_id` + `invoice_number`
4. Lee memoria actual del proveedor (`tenant_supplier_memory`)
5. Construye `newMemory` desde los campos del payload
6. Actualiza `result_json.manual_classification` + `requires_review` en la factura
7. Genera filas de auditoría (una por campo modificado)
8. Inserta en `tenant_reclassification_audit`
9. Upsert en `tenant_supplier_memory` (incrementa `times_seen`, recalcula `confidence`)
10. Devuelve `{ ok, invoice_id, calculation_updated, memory_updated, audit_rows_created, warnings? }`

### 2.2 Reclasificación de Línea
```
POST /api/v1/invoices/:invoiceId/lines/:lineId/reclassify
```
**Archivo:** `apps/web/app/api/v1/invoices/[invoiceId]/lines/[lineId]/reclassify/route.ts`

**Flujo:**
1. Resuelve `tenant_id` + `user_id` desde Bearer token
2. Valida payload con `validateLineReclassificationPayload`
3. Busca `invoice_tax_calculations` por `tenant_id` + `invoice_number`
4. Busca la línea en `result_json.classified_lines` por `line_id` o `source_line_number`
5. Captura el estado anterior de la línea
6. Aplica los cambios y marca `manual_override: true`
7. Actualiza `result_json` + `requires_review=true` + warning de recálculo pendiente
8. Genera auditoría por campo
9. Inserta en `tenant_reclassification_audit`
10. Normaliza el patrón de descripción y hace upsert en `tenant_tax_classification_memory`
11. Devuelve `{ ok, invoice_id, line_id, calculation_updated, classification_memory_updated, audit_rows_created, warnings? }`

---

## 3. Payloads Soportados

### 3.1 Invoice Reclassify
```typescript
{
  cost_or_expense?: "cost" | "expense" | "asset" | "liability" | "unknown",
  account_code?: string,            // código contable del gasto
  payable_account_code?: string,    // cuenta por pagar
  retefuente_concept?: string,      // concepto de retención en la fuente
  reteica_city?: string,            // ciudad para retención ICA
  reteica_kind?: "service" | "purchase",
  mark_as_reviewed?: boolean,       // limpia requires_review si true
  reason: string                    // OBLIGATORIO · mínimo 8 caracteres
}
```

### 3.2 Line Reclassify
```typescript
{
  kind?: "purchase" | "service" | "mixed" | "unknown",
  account_code?: string,
  retefuente_concept?: string,
  reteica_kind?: "service" | "purchase",
  exclude_from_withholding?: boolean,
  reason: string                    // OBLIGATORIO · mínimo 8 caracteres
}
```

---

## 4. Validaciones (reclassification.ts)

**Archivo:** `apps/web/lib/tax/reclassification.ts`

### Reglas aplicadas a todos los payloads:
| Regla | Comportamiento |
|-------|---------------|
| `reason` ausente | `throw "reason es obligatorio"` |
| `reason` < 8 chars (post-trim) | `throw "reason debe tener al menos 8 caracteres"` |
| Campo desconocido en payload | `throw "Campo no permitido: <campo>"` |
| Enum inválido | `throw "<campo> inválido"` |
| `account_code` vacío (`""`) | `throw "account_code no puede estar vacío si se proporciona"` |

### Sets de campos conocidos:
- **Invoice:** `cost_or_expense`, `account_code`, `payable_account_code`, `retefuente_concept`, `reteica_city`, `reteica_kind`, `mark_as_reviewed`, `reason`
- **Line:** `kind`, `account_code`, `retefuente_concept`, `reteica_kind`, `exclude_from_withholding`, `reason`

---

## 5. Auditoría — Tabla `tenant_reclassification_audit`

Se registra **una fila por cada campo que cambia de valor**. Si `old === new`, no se crea fila. Esto garantiza trazabilidad granular y evita ruido.

**Función:** `buildAuditRows(oldData, newData, context): ReclassificationAuditRow[]`

### Campos de auditoría por fila:
| Campo | Descripción |
|-------|-------------|
| `tenant_id` | Tenant propietario |
| `invoice_id` | UUID del cálculo (`invoice_tax_calculations.id`) |
| `factura_dian_id` | Opcional: UUID de la factura DIAN original |
| `calculation_id` | UUID del cálculo (igual a `invoice_id` en esta implementación) |
| `line_id` | Solo en reclasificación de líneas |
| `supplier_nit` | NIT del proveedor |
| `supplier_name` | Nombre del proveedor |
| `field_name` | Nombre del campo modificado |
| `old_value_json` | Valor anterior (JSONB) |
| `new_value_json` | Nuevo valor (JSONB) |
| `reason` | Motivo proporcionado por el usuario |
| `user_id` | UUID del usuario que reclasifica (si hay auth) |

### Cambios SQL requeridos:
```sql
ALTER TABLE tenant_reclassification_audit
  ADD COLUMN IF NOT EXISTS invoice_id uuid,
  ADD COLUMN IF NOT EXISTS factura_dian_id uuid,
  ADD COLUMN IF NOT EXISTS line_id text,
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS field_name text,
  ADD COLUMN IF NOT EXISTS old_value_json jsonb,
  ADD COLUMN IF NOT EXISTS new_value_json jsonb;

ALTER TABLE tenant_reclassification_audit
  ALTER COLUMN field_changed DROP NOT NULL;
```

---

## 6. Memoria por Proveedor — `tenant_supplier_memory`

Cuando se reclasifica una factura, los campos del payload se persisten en la tabla
`tenant_supplier_memory` para aplicarse automáticamente en futuras clasificaciones
del mismo proveedor.

**Estrategia de upsert:** `onConflict: "tenant_id,supplier_nit"`

**Campos actualizados:**
- `default_cost_or_expense`
- `default_account_code`
- `default_payable_account`
- `default_retefuente_concept`
- `default_reteica_city`
- `default_reteica_kind`
- `times_seen` (incrementado en +1)
- `confidence` (recalculado con `calculateUpdatedConfidence`)
- `source: "manual_reclassification"`
- `updated_at: now()`

**Fórmula de confianza:**
```typescript
calculateUpdatedConfidence(timesSeen: number): number
  → Math.min(0.95, 0.5 + timesSeen * 0.05)
  // timesSeen=1 → 0.55 | timesSeen=5 → 0.75 | timesSeen=9+ → 0.95
```

### Cambios SQL requeridos en `tenant_supplier_memory`:
```sql
ALTER TABLE tenant_supplier_memory
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb;

-- Actualizar CHECK constraint para incluir 'liability'
ALTER TABLE tenant_supplier_memory
  DROP CONSTRAINT IF EXISTS tenant_supplier_memory_default_cost_or_expense_check;
ALTER TABLE tenant_supplier_memory
  ADD CONSTRAINT tenant_supplier_memory_default_cost_or_expense_check
  CHECK (default_cost_or_expense IN ('cost','expense','asset','liability','unknown'));
```

---

## 7. Memoria por Patrón de Línea — `tenant_tax_classification_memory` (NUEVA)

Cuando se reclasifica una **línea específica**, el sistema normaliza la descripción
del ítem y persiste la clasificación para aprendizaje futuro.

**Función de normalización:** `normalizeDescriptionPattern(description: string): string`
- Convierte a minúsculas
- Normaliza NFD y elimina marcas combinantes (tildes, diacríticos)
- Elimina secuencias de 6+ dígitos (números de factura, códigos, etc.)
- Colapsa espacios múltiples → uno
- Limita a 120 caracteres

**Tabla nueva:** `tenant_tax_classification_memory`
```sql
CREATE TABLE IF NOT EXISTS public.tenant_tax_classification_memory (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  supplier_nit          text,
  description_pattern   text NOT NULL,
  kind                  text CHECK (kind IN ('purchase','service','mixed','unknown') OR kind IS NULL),
  account_code          text,
  retefuente_concept    text,
  reteica_kind          text CHECK (reteica_kind IN ('service','purchase') OR reteica_kind IS NULL),
  confidence            numeric(5,2) NOT NULL DEFAULT 0,
  times_seen            integer NOT NULL DEFAULT 1,
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  metadata_json         jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ttcm_tenant_supplier_pattern
    UNIQUE (tenant_id, supplier_nit, description_pattern)
);
```

**Estrategia de upsert:** `onConflict: "tenant_id,supplier_nit,description_pattern"`

---

## 8. Integración con `result_json` en `invoice_tax_calculations`

Las líneas de factura no tienen tabla propia. Viven en `result_json.classified_lines`
(JSONB array). Este diseño implica:

| Operación | Mecanismo |
|-----------|-----------|
| Buscar una línea | `classified_lines.findIndex(l => l.line_id === lineId \|\| String(l.source_line_number) === lineId)` |
| Aplicar cambios | Inmutabilidad: copia del array con la línea modificada |
| Persistir | `UPDATE invoice_tax_calculations SET result_json = { ...resultJson, classified_lines: updatedLines }` |
| Señal de recálculo | `warnings_json` array — se agrega `"Reclasificación manual aplicada; recalcular impuestos pendiente"` (idempotente) |
| `manual_override` | Marca `true` en la línea para distinguir cambios manuales de automáticos |

Para reclasificación de factura, la clasificación se almacena en:
```json
result_json.manual_classification = {
  cost_or_expense, account_code, payable_account_code,
  retefuente_concept, reteica_city, reteica_kind,
  applied_at, reason
}
```

---

## 9. Seguridad y Aislamiento de Tenant

| Control | Implementación |
|---------|---------------|
| Tenant isolation | `tenant_id` resuelto server-side — nunca desde el body |
| Bearer auth | `supabase.auth.getUser(token)` → `users.tenant_id` |
| Fallback single-tenant | `SELECT id FROM tenants ORDER BY created_at LIMIT 1` |
| Double-check en UPDATE | `.eq("id", calc.id).eq("tenant_id", tenantId)` |
| Validación de enums | Whitelist explícita — no interpolación en SQL |
| `reason` obligatorio | Mínimo 8 chars — siempre almacenado como texto, nunca en SQL raw |
| Campos desconocidos | Rechazados con error claro (no silenciosos) |

---

## 10. SQL Revisado / Creado

**Archivo:** `database/supabase_tenant_memory.sql`

Sección añadida al final del archivo (etiquetada `-- Migración adicional: Task 6`):

1. **`CREATE TABLE tenant_tax_classification_memory`** — nueva, con índices y trigger `updated_at`
2. **`ALTER TABLE tenant_supplier_memory`** — agrega `source`, `metadata_json`; actualiza CHECK de `default_cost_or_expense` para incluir `'liability'`
3. **`ALTER TABLE tenant_reclassification_audit`** — agrega `invoice_id`, `factura_dian_id`, `line_id`, `supplier_name`, `field_name`, `old_value_json`, `new_value_json`; quita `NOT NULL` de `field_changed`; agrega índices

> ⚠️ **NO ejecutar en Supabase producción** hasta aprobación del informe final (Task 8).

---

## 11. Tests Agregados — 38 nuevos

**Archivo:** `apps/web/__tests__/tax/reclassification.test.ts`

| Suite | Tests |
|-------|-------|
| `validateInvoiceReclassificationPayload` | 11 |
| `validateLineReclassificationPayload` | 7 |
| `normalizeDescriptionPattern` | 6 |
| `calculateUpdatedConfidence` | 8 |
| `buildAuditRows` | 6 |
| **Total** | **38** |

**Casos cubiertos:**
- Lanza si `reason` ausente o < 8 chars
- Lanza con campos desconocidos
- Lanza con enums inválidos
- Lanza con strings vacíos en campos opcionales de tipo string
- Acepta payload completo válido
- Acepta `cost_or_expense: "liability"` (valor nuevo)
- Acepta `mark_as_reviewed: true`
- Acepta `exclude_from_withholding: false`
- Acepta payload sin campos opcionales (solo `reason`)
- Trim de `reason`
- `normalizeDescriptionPattern`: minúsculas, tildes, 6+ dígitos, espacios, límite 120 chars, conserva 5 dígitos
- `calculateUpdatedConfidence`: curva correcta, cap en 0.95, `timesSeen=0 → 0.5`
- `buildAuditRows`: una fila por campo, no crea si old===new, captura tipos, incluye contexto, line_id, excluye opcionales no pasados

---

## 12. Resultado Vitest

```
Test Files  8 passed (8)
     Tests  141 passed (141)
  Duration  ~2.0s
```

| Archivo | Tests |
|---------|-------|
| `__tests__/api/tax-calculations-filters.test.ts` | 30 |
| `__tests__/tax/reclassification.test.ts` | 38 ← nuevo |
| `__tests__/tax/reteiva.test.ts` | 6 |
| `__tests__/tax/retefuente.test.ts` | 5 |
| `__tests__/tax/reteica.test.ts` | 8 |
| `__tests__/dian-extraction.test.ts` | 28 |
| `__tests__/tax/marzo-batch.test.ts` | 7 |
| `__tests__/tax/factura-grande.test.ts` | 19 |
| **Total** | **141** |

---

## 13. Resultado Build

```
✓ Compiled successfully in ~8s
```

Fix aplicado: `calcData` (tipo `GenericStringError` de Supabase) casteado a
`unknown` antes de `Record<string, unknown>` en ambas routes para satisfacer
el compilador TypeScript strict.

---

## 14. Archivos Modificados / Creados

| Archivo | Operación | Descripción |
|---------|-----------|-------------|
| `apps/web/lib/tax/reclassification.ts` | ✅ Creado | Funciones puras: validación, auditoría, normalización, confianza |
| `apps/web/app/api/v1/invoices/[invoiceId]/reclassify/route.ts` | ✅ Reescrito | Endpoint reclasificación de factura |
| `apps/web/app/api/v1/invoices/[invoiceId]/lines/[lineId]/reclassify/route.ts` | ✅ Reescrito | Endpoint reclasificación de línea |
| `apps/web/__tests__/tax/reclassification.test.ts` | ✅ Creado | 38 tests unitarios |
| `database/supabase_tenant_memory.sql` | ✅ Modificado | Sección SQL Task 6 agregada al final |

---

## 15. Pendientes Post-Aprobación

| Pendiente | Acción requerida | Quién |
|-----------|-----------------|-------|
| SQL en Supabase | Ejecutar sección "Task 6" de `supabase_tenant_memory.sql` | Usuario / DBA |
| Recálculo automático | Después de reclasificación, el sistema NO recalcula impuestos automáticamente — `warnings_json` avisa | Feature futura |
| RLS en `tenant_tax_classification_memory` | Agregar políticas RLS una vez ejecutada la migración | CLO / Security |
| Tests de integración de routes | Los routes no tienen mocks de Supabase — coverage de integración pendiente | QA |

---

## 16. Notas Técnicas

### Por qué `result_json` y no tabla propia para líneas
No existe tabla `invoice_line_classifications`. Las líneas son parte del
resultado del motor de clasificación (`ClassifiedInvoiceLine[]`) y viven
en el JSONB de `invoice_tax_calculations`. Modificar la estructura de datos
requeriría una migración mayor; la solución actual es compatible sin migraciones
de esquema en la tabla principal.

### Idempotencia del warning de recálculo
El warning `"Reclasificación manual aplicada; recalcular impuestos pendiente"` se
agrega solo si no está ya presente en `warnings_json`, evitando duplicados en
reclasificaciones sucesivas de la misma línea.

### `manual_override: true` en líneas
Cualquier línea que haya sido modificada manualmente tiene el flag `manual_override: true`
en su objeto dentro de `classified_lines`. Esto permite que el motor de clasificación
automática no sobreescriba cambios manuales en futuras ejecuciones.

---

## 17. Para ChatGPT — Prompt de Integración

```
Contexto: ETL_V1 — Next.js 15 + Supabase. Se implementó reclasificación manual
de facturas DIAN (Task 6). Los endpoints son:

POST /api/v1/invoices/:invoiceId/reclassify
  Body: { cost_or_expense?, account_code?, payable_account_code?,
          retefuente_concept?, reteica_city?, reteica_kind?,
          mark_as_reviewed?, reason (obligatorio ≥8 chars) }
  Resultado: actualiza result_json.manual_classification + tenant_supplier_memory
             + tenant_reclassification_audit

POST /api/v1/invoices/:invoiceId/lines/:lineId/reclassify
  Body: { kind?, account_code?, retefuente_concept?,
          reteica_kind?, exclude_from_withholding?, reason (obligatorio ≥8 chars) }
  Resultado: actualiza result_json.classified_lines[lineId] + tenant_tax_classification_memory
             + tenant_reclassification_audit

Tablas afectadas:
- invoice_tax_calculations (result_json JSONB, requires_review, warnings_json)
- tenant_supplier_memory (upsert por tenant_id+supplier_nit)
- tenant_tax_classification_memory (NUEVA, upsert por tenant_id+supplier_nit+description_pattern)
- tenant_reclassification_audit (append-only, una fila por campo)

Tests: 141/141 passing. Build: ✓ Compiled successfully.
SQL pendiente: database/supabase_tenant_memory.sql (sección Task 6)
```

---

## 18. Criterios de Aceptación Verificados

| Criterio | Estado |
|----------|--------|
| Endpoint factura acepta todos los campos especificados | ✅ |
| Endpoint línea acepta todos los campos especificados | ✅ |
| `reason` obligatorio con mínimo 8 chars | ✅ Validado + testeado |
| Campos desconocidos rechazados | ✅ Validado + testeado |
| Enums válidos (incluye `liability`) | ✅ Validado + testeado |
| Auditoría: una fila por campo modificado | ✅ Implementado + testeado |
| Memoria proveedor actualizada con `times_seen++` y confianza recalculada | ✅ Implementado |
| Memoria por patrón de línea (nueva tabla) | ✅ SQL + upsert implementados |
| Aislamiento de tenant (nunca desde body) | ✅ Bearer token / fallback |
| `manual_override: true` en líneas reclasificadas | ✅ Implementado |
| Warning de recálculo pendiente (idempotente) | ✅ Implementado |
| 0 errores TypeScript (build limpio) | ✅ `✓ Compiled successfully` |
| 141/141 tests passing | ✅ Vitest confirmado |
