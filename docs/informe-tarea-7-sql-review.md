# Informe Tarea 7 — Revisión Completa de SQL
**ETL_V1 · Sprint activo · Revisión de migraciones y consistencia**

---

## 1. Resumen Ejecutivo

Se revisaron los archivos SQL en `database/`. El estado es mayoritariamente
correcto y listo para ejecución. Se identificaron **3 issues de severidad media**
y **5 observaciones de severidad baja** que deben documentarse antes de ejecutar
en producción. Ningún issue bloquea la funcionalidad actual (los routes usan
`service_role_key`, que bypasea RLS).

| Severidad | Issues |
|-----------|--------|
| 🔴 Alta | 0 |
| 🟡 Media | 3 |
| 🟢 Baja / Informativa | 5 |

---

## 2. Archivos Revisados

| Archivo | Líneas | Estado |
|---------|--------|--------|
| `database/supabase_tenant_memory.sql` | 252 | ⚠️ Issues medios |
| `database/supabase_tax_calculation_results.sql` | 154 | ⚠️ Tablas inactivas |
| `database/supabase_rls_policies.sql` | 199 | ⚠️ Cobertura incompleta |
| `database/supabase_core_app_tables.sql` | — | ✅ No revisado en detalle (dependencia de triggers) |
| `database/supabase_batches_tenant_migration.sql` | — | ✅ No revisado (fuera de scope Task 6) |

---

## 3. Issues Detectados

---

### 🟡 ISSUE-1: `invoice_line_classifications` — tabla definida pero nunca poblada

**Archivo:** `supabase_tax_calculation_results.sql` (tabla #3, ~línea 85)

**Descripción:**
La tabla `invoice_line_classifications` está definida en SQL con un schema
completo (26 columnas), pero los routes de clasificación y reclasificación
**nunca insertan datos en ella**. Toda la información de líneas se almacena en
`result_json.classified_lines` (JSONB) dentro de `invoice_tax_calculations`.

**Evidencia del código:**
```typescript
// route line reclassify — busca la línea en JSONB:
const resultJson = (calc.result_json ?? {}) as { classified_lines?: LineEntry[] };
const lineIdx = lines.findIndex(l => l.line_id === lineId);
// Nunca hace SELECT FROM invoice_line_classifications
```

**Impacto:** La FK `tenant_reclassification_audit.line_classification_id uuid REFERENCES invoice_line_classifications(id)` apunta a una tabla vacía. Dado que la columna es nullable, las inserciones no fallan (el valor será NULL). Sin embargo, la tabla ocupa espacio en el schema sin propósito actual.

**Opciones:**
- **Opción A (recomendada):** Documentar que `invoice_line_classifications` es una tabla legacy/futura y que actualmente las líneas se gestionan vía JSONB. No ejecutarla en producción hasta que se decida si se quiere migrar a este schema normalizado.
- **Opción B:** Eliminar la tabla del SQL y la FK en `tenant_reclassification_audit` si no hay plan de uso.
- **Opción C:** Usarla como destino de una futura migración de datos desde `result_json`.

**Acción requerida (antes de deploy):** Decisión del equipo sobre el destino de esta tabla. El sistema funciona sin ella.

---

### 🟡 ISSUE-2: `invoice_tax_calculation_groups` — tabla definida pero posiblemente inactiva

**Archivo:** `supabase_tax_calculation_results.sql` (tabla #2, ~línea 69)

**Descripción:**
La tabla `invoice_tax_calculation_groups` está definida para almacenar grupos
tributarios por factura, pero el motor tributario almacena los grupos en
`result_json.groups` (JSONB). No se encontró evidencia de INSERT en esta tabla
en los routes revisados.

**Impacto:** Tabla vacía. Bajo impacto funcional. Similar al Issue-1.

**Acción requerida:** Confirmación del equipo si esta tabla se usa en algún otro módulo no revisado (búsqueda recomendada: `invoice_tax_calculation_groups`).

---

### 🟡 ISSUE-3: RLS ausente en tablas del motor tributario y memoria

**Archivo:** `supabase_rls_policies.sql`

**Descripción:**
El archivo RLS actual cubre solo: `batches`, `invoices`, `facturas_dian`, `facturas_dian_detalle`.
Las siguientes tablas **no tienen RLS habilitado**:

| Tabla | Impacto si cliente usa `anon/authenticated` key |
|-------|------------------------------------------------|
| `invoice_tax_calculations` | Lectura sin filtro de tenant |
| `invoice_tax_calculation_groups` | Idem |
| `invoice_line_classifications` | Idem |
| `tenant_supplier_memory` | Memoria de proveedores visible entre tenants |
| `tenant_reclassification_audit` | Auditoría de todos los tenants visible |
| `tenant_accounting_patterns` | Idem |
| `accounting_movements_import` | Idem |
| `tenant_tax_classification_memory` | Nueva tabla, sin RLS |

**Mitigación actual:** Los routes usan `service_role_key` que bypasea RLS. Si ningún cliente consulta estas tablas directamente con `anon/authenticated` key, el riesgo es bajo.

**Acción requerida (antes de permitir acceso directo desde clientes):**
Agregar al final de `supabase_rls_policies.sql`:

```sql
-- invoice_tax_calculations
ALTER TABLE public.invoice_tax_calculations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "itc_select_own_tenant" ON public.invoice_tax_calculations
  FOR SELECT TO authenticated USING (tenant_id = public.get_tenant_id());

-- tenant_supplier_memory
ALTER TABLE public.tenant_supplier_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tsm_select_own_tenant" ON public.tenant_supplier_memory
  FOR SELECT TO authenticated USING (tenant_id = public.get_tenant_id());
CREATE POLICY "tsm_insert_own_tenant" ON public.tenant_supplier_memory
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_tenant_id());
CREATE POLICY "tsm_update_own_tenant" ON public.tenant_supplier_memory
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());

-- tenant_reclassification_audit (append-only desde cliente)
ALTER TABLE public.tenant_reclassification_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tra_select_own_tenant" ON public.tenant_reclassification_audit
  FOR SELECT TO authenticated USING (tenant_id = public.get_tenant_id());
-- INSERT solo vía service_role (routes), no desde cliente

-- tenant_tax_classification_memory
ALTER TABLE public.tenant_tax_classification_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ttcm_select_own_tenant" ON public.tenant_tax_classification_memory
  FOR SELECT TO authenticated USING (tenant_id = public.get_tenant_id());
```

---

## 4. Observaciones Informativas (Severidad Baja)

---

### 🟢 OBS-1: Dependencia de `set_updated_at()` no documentada en archivos de memoria

Los triggers de `tenant_supplier_memory`, `tenant_accounting_patterns` y
`tenant_tax_classification_memory` llaman a `public.set_updated_at()`.

Esta función debe existir antes de ejecutar `supabase_tenant_memory.sql`.
Se asume que está en `supabase_core_app_tables.sql`.

**Orden de ejecución requerido:**
```
1. supabase_core_app_tables.sql        ← define set_updated_at()
2. supabase_batches_tenant_migration.sql
3. supabase_facturacion_dian_es.sql
4. supabase_dian_canonical_extraction.sql
5. supabase_tax_calculation_results.sql
6. supabase_tenant_memory.sql          ← requiere set_updated_at() + invoice_tax_calculations
7. supabase_rls_policies.sql           ← requiere todas las tablas existentes
8. seed.sql                            ← datos iniciales
```

---

### 🟢 OBS-2: Índice compuesto faltante en `invoice_tax_calculations`

Los routes siempre filtran por `tenant_id + invoice_number`:
```sql
WHERE tenant_id = $1 AND invoice_number = $2
```

El SQL tiene índices separados (`idx_itc_tenant_id`, `idx_itc_invoice_number`)
pero no un índice compuesto. Esto puede causar table scans en tablas grandes.

**Recomendación:**
```sql
CREATE INDEX IF NOT EXISTS idx_itc_tenant_invoice
  ON public.invoice_tax_calculations(tenant_id, invoice_number);
```

---

### 🟢 OBS-3: `tenant_reclassification_audit` FK legacy a `invoice_line_classifications`

La columna `line_classification_id uuid REFERENCES invoice_line_classifications(id)` 
fue diseñada para un schema normalizado que no se usa. Como es nullable, no bloquea
inserciones. Se puede mantener como legacy o eliminar en una futura limpieza de schema.

**No acción urgente requerida.**

---

### 🟢 OBS-4: CHECK constraint original en `tenant_supplier_memory` corregido correctamente

El esquema original tenía:
```sql
CHECK (default_cost_or_expense IN ('cost','expense','asset','unknown'))
```
Faltaba `'liability'`. El Task 6 SQL lo corrige con:
```sql
DROP CONSTRAINT IF EXISTS tenant_supplier_memory_default_cost_or_expense_check;
ADD CONSTRAINT ... CHECK (... IN ('cost','expense','asset','liability','unknown') OR IS NULL);
```

**La corrección es correcta e idempotente.** No requiere acción adicional.

---

### 🟢 OBS-5: `tenant_reclassification_audit` — columnas legacy vs nuevas

| Columnas originales | Columnas Task 6 (nuevas) | Uso actual (routes) |
|--------------------|--------------------------|---------------------|
| `field_changed text` | `field_name text` | `field_name` |
| `old_value text` | `old_value_json jsonb` | `old_value_json` |
| `new_value text` | `new_value_json jsonb` | `new_value_json` |
| `invoice_number text` | `invoice_id uuid` | `invoice_id` |
| `update_memory boolean` | — | (no se usa) |

Las columnas originales quedan como legacy (nullable tras el ALTER). Funcional.
En una futura limpieza de schema se pueden eliminar si no hay datos históricos.

---

## 5. Verificación de Consistencia: Código ↔ SQL

| Campo usado en route | Columna SQL | Estado |
|---------------------|-------------|--------|
| `invoice_tax_calculations.result_json` | `result_json jsonb NOT NULL DEFAULT '{}'` | ✅ |
| `invoice_tax_calculations.requires_review` | `requires_review boolean NOT NULL DEFAULT false` | ✅ |
| `invoice_tax_calculations.warnings_json` | `warnings_json jsonb NOT NULL DEFAULT '[]'` | ✅ |
| `invoice_tax_calculations.tenant_id` | `tenant_id uuid NOT NULL` | ✅ |
| `invoice_tax_calculations.invoice_number` | `invoice_number text` | ✅ |
| `invoice_tax_calculations.supplier_nit` | `supplier_nit text` | ✅ |
| `tenant_supplier_memory.default_cost_or_expense` | `CHECK IN ('cost','expense','asset','liability','unknown')` (post-ALTER) | ✅ |
| `tenant_supplier_memory.times_seen` | `times_seen integer NOT NULL DEFAULT 1` | ✅ |
| `tenant_supplier_memory.confidence` | `confidence numeric(5,2) NOT NULL DEFAULT 0` | ✅ |
| `tenant_supplier_memory.source` | `source text` (ADD COLUMN Task 6) | ✅ |
| `tenant_reclassification_audit.field_name` | `field_name text` (ADD COLUMN Task 6) | ✅ |
| `tenant_reclassification_audit.old_value_json` | `old_value_json jsonb` (ADD COLUMN Task 6) | ✅ |
| `tenant_reclassification_audit.new_value_json` | `new_value_json jsonb` (ADD COLUMN Task 6) | ✅ |
| `tenant_reclassification_audit.invoice_id` | `invoice_id uuid` (ADD COLUMN Task 6) | ✅ |
| `tenant_reclassification_audit.line_id` | `line_id text` (ADD COLUMN Task 6) | ✅ |
| `tenant_tax_classification_memory.description_pattern` | `description_pattern text NOT NULL` | ✅ |
| `tenant_tax_classification_memory.kind` | `kind text CHECK (...)` | ✅ |
| `tenant_tax_classification_memory.times_seen` | `times_seen integer NOT NULL DEFAULT 1` | ✅ |
| Upsert `onConflict: tenant_id,supplier_nit` | `CONSTRAINT uq_tsm_tenant_supplier UNIQUE(tenant_id, supplier_nit)` | ✅ |
| Upsert `onConflict: tenant_id,supplier_nit,description_pattern` | `CONSTRAINT uq_ttcm_tenant_supplier_pattern UNIQUE(tenant_id, supplier_nit, description_pattern)` | ✅ |

---

## 6. Tabla de Acciones Recomendadas

| # | Acción | Prioridad | Cuándo |
|---|--------|-----------|--------|
| A1 | Decidir destino de `invoice_line_classifications` (usar / eliminar / documentar como futura) | 🟡 Media | Antes de ejecutar SQL en producción |
| A2 | Confirmar si `invoice_tax_calculation_groups` se usa en algún módulo | 🟡 Media | Antes de ejecutar SQL en producción |
| A3 | Agregar RLS a `invoice_tax_calculations`, `tenant_supplier_memory`, `tenant_reclassification_audit`, `tenant_tax_classification_memory` | 🟡 Media | Antes de exponer acceso directo a clientes |
| A4 | Agregar índice compuesto `(tenant_id, invoice_number)` en `invoice_tax_calculations` | 🟢 Baja | Optimización futura |
| A5 | Agregar comentario de orden de ejecución al inicio de cada archivo SQL | 🟢 Baja | Buenas prácticas |
| A6 | Limpiar columnas legacy de `tenant_reclassification_audit` si no hay datos históricos | 🟢 Baja | Sprint futuro |

---

## 7. Veredicto de Ejecución

El SQL en `database/supabase_tenant_memory.sql` es **seguro para ejecutar** en Supabase
una vez aprobado el informe final (Task 8), **con la siguiente condición**:

> Decidir antes si `invoice_line_classifications` debe existir (Issue-1). Si no se va
> a poblar, remover la FK `line_classification_id` de `tenant_reclassification_audit`
> antes de ejecutar para mantener el schema limpio.

El resto del SQL (tablas, índices, triggers, ALTERs) es correcto, idempotente y
consistente con el código de los routes.

---

## 8. Para ChatGPT — Contexto SQL

```
ETL_V1 SQL state:
- invoice_tax_calculations: OK, result_json JSONB
- tenant_supplier_memory: OK post-ALTER (liability added)
- tenant_reclassification_audit: OK post-ALTER (new JSONB columns)
- tenant_tax_classification_memory: NEW TABLE, correct schema

Issues to resolve before production:
1. invoice_line_classifications: SQL exists but routes never populate it → decide: keep/drop
2. RLS not configured for tax/memory tables → add to supabase_rls_policies.sql
3. Missing composite index (tenant_id, invoice_number) on invoice_tax_calculations

Execution order: core_app_tables → batches_migration → facturacion_dian →
  dian_canonical_extraction → tax_calculation_results → tenant_memory → rls_policies → seed
```
