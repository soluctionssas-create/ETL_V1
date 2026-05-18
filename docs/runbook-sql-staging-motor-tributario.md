# Runbook: Ejecución SQL en Staging — Motor Tributario ETL_V1

**Versión:** 1.0.0  
**Fecha:** 2025-07-16  
**Autor:** CEO Agent (GitHub Copilot)  
**Commit de referencia:** `ecac162` (main)  
**Propósito:** Guía de ejecución paso a paso para aplicar el esquema completo del motor tributario en el ambiente de Staging (Supabase). Cubre pre-checks, orden de scripts, verificación post-ejecución y criterios de aprobación para promover a producción.

---

## 1. Objetivo

Aplicar el esquema de base de datos del motor tributario ETL_V1 en el ambiente de **Staging** de Supabase, de forma segura, reproducible y verificable, sin afectar datos ni permisos del ambiente de producción.

**Lo que se logra al finalizar este runbook:**
- Todas las tablas del motor tributario existen y tienen las columnas correctas.
- Los índices de performance están creados.
- RLS (Row Level Security) está habilitado en las 8 tablas del motor.
- Todas las políticas de acceso por `tenant_id` están activas.
- La API responde correctamente para los smoke tests definidos.

---

## 2. Alcance

| Script | Propósito | Ambiente |
|--------|-----------|----------|
| `database/supabase_core_app_tables.sql` | Tablas base: `batches`, `invoices` (extensión) | Staging ONLY |
| `database/supabase_facturacion_dian_es.sql` | Tablas DIAN: `facturas_dian`, `facturas_dian_detalle` | Staging ONLY |
| `database/supabase_tax_calculation_results.sql` | Tablas motor tributario: `invoice_tax_calculations` + reservadas | Staging ONLY |
| `database/supabase_tenant_memory.sql` | Memoria tenant: 5 tablas de aprendizaje y auditoría | Staging ONLY |
| `database/supabase_rls_policies.sql` | Todas las políticas RLS de los 8 módulos | Staging ONLY |

### ⛔ Archivos EXCLUIDOS de este runbook

| Archivo | Motivo |
|---------|--------|
| `database/schema.sql` | Schema SQLAlchemy para FastAPI local. **NUNCA ejecutar en Supabase.** |
| `database/seed.sql` | Datos de prueba. Ejecutar manualmente solo si se necesita en staging. |
| `database/supabase_batches_tenant_migration.sql` | Migración multi-tenant de batches — ya fue aplicada en producción. Verificar estado en staging antes de re-ejecutar. |
| `database/supabase_dian_canonical_extraction.sql` | Pipeline canónico DIAN — scope separado, no es parte del motor tributario. |

---

## 3. Ambiente Objetivo

```
Proyecto Supabase: STAGING (NO es el proyecto de producción)
URL dashboard:    https://app.supabase.com → proyecto de staging
SQL Editor:       Dashboard → SQL Editor → New query
```

**Cómo distinguir staging de producción:**
- Staging usa un `SUPABASE_URL` diferente al de producción.
- Verificar en `supabase/.temp/linked-project.json` el `project_ref` activo.
- En VS Code / terminal: `cat supabase/.temp/linked-project.json`

> ⚠️ **NUNCA ejecutar estos scripts en el proyecto de producción.** El ambiente de staging debe estar correctamente enlazado antes de proceder.

---

## 4. Pre-checks Antes de Ejecutar

Completar **todos** antes de abrir el SQL Editor:

### 4.1 Verificación de identidad del proyecto

```sql
-- Ejecutar en SQL Editor para confirmar que estás en staging
SELECT current_database(), version();
```

- Confirmar visualmente en el dashboard de Supabase que el nombre del proyecto corresponde al de staging.

### 4.2 Verificación de tablas base (deben existir antes de step 1)

Las siguientes tablas deben haber sido creadas por `SUPABASE_AUTH_SETUP.md` o por una ejecución previa:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('tenants', 'users', 'invoices')
ORDER BY table_name;
```

Resultado esperado: 3 filas (`invoices`, `tenants`, `users`).

> Si falta alguna, ejecutar `SUPABASE_AUTH_SETUP.md` primero. Este runbook asume que ese setup ya está completo.

### 4.3 Verificación de función `public.get_tenant_id()`

```sql
SELECT proname, pronamespace::regnamespace AS schema
FROM pg_proc
WHERE proname = 'get_tenant_id';
```

Resultado esperado: 1 fila con `schema = 'public'`. Esta función es requerida por todas las políticas RLS.

> Si no existe, revisar si `supabase_rls_policies.sql` la define (sí la define como `CREATE OR REPLACE FUNCTION`). En ese caso se creará en el paso 5.

### 4.4 Estado del repositorio local

```powershell
# Desde la raíz del proyecto
git log --oneline -1
# Debe mostrar: ecac162 chore: harden tax engine SQL and RLS policies

git status
# Debe mostrar: nothing to commit, working tree clean
```

### 4.5 Backup de staging (recomendado)

Tomar snapshot en el dashboard de Supabase → **Database → Backups → Create backup** antes de ejecutar.

---

## 5. Orden Exacto de Scripts

> ⚠️ El orden es OBLIGATORIO por dependencias de FK y creación de funciones.

```
[1] database/supabase_core_app_tables.sql
[2] database/supabase_facturacion_dian_es.sql
[3] database/supabase_tax_calculation_results.sql
[4] database/supabase_tenant_memory.sql
[5] database/supabase_rls_policies.sql
```

**Diagrama de dependencias:**
```
[1] crea: batches
         ↓ FK batch_id
[2] crea: facturas_dian, facturas_dian_detalle
         (ambas referencian batches)
[3] crea: invoice_tax_calculations, invoice_line_classifications,
          invoice_tax_calculation_groups
         (invoice_tax_calculations referencia batches vía batch_id)
[4] crea: tenant_supplier_memory, tenant_accounting_patterns,
          tenant_reclassification_audit, accounting_movements_import,
          tenant_tax_classification_memory
         (sin FK directas a [2] o [3] — independiente)
[5] habilita RLS + crea/reemplaza función get_tenant_id()
         + crea políticas para todas las tablas de [2], [3], [4]
```

---

## 6. Scripts a Ejecutar

### Script 1: `database/supabase_core_app_tables.sql`

**Qué hace:**
- `CREATE TABLE IF NOT EXISTS public.batches` — tabla de lotes de carga
- `ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS` — extensión de invoices (batch_id, vendor_name, vendor_tax_id, total_amount, tax_amount, status)
- Índices en `batches` e `invoices`

**Confirmación de idempotencia:** Usa `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS`. Seguro re-ejecutar.

**Cómo ejecutar:**
1. Abrir SQL Editor en Supabase Staging
2. Copiar contenido de `database/supabase_core_app_tables.sql`
3. Click **Run**
4. Verificar que no haya errores en la salida

---

### Script 2: `database/supabase_facturacion_dian_es.sql`

**Qué hace:**
- `CREATE TABLE IF NOT EXISTS public.facturas_dian` — facturas DIAN con 50+ columnas (emisor, adquiriente, totales, pago, metadatos)
- `CREATE TABLE IF NOT EXISTS public.facturas_dian_detalle` — líneas de cada factura DIAN
- `CREATE OR REPLACE FUNCTION public.set_updated_at()` — trigger automático de updated_at
- Triggers, índices y extensión `pgcrypto`

**Confirmación de idempotencia:** `IF NOT EXISTS` en tablas/índices, `CREATE OR REPLACE` en función y triggers.

**Cómo ejecutar:** Igual que Script 1. Sin errores esperados.

---

### Script 3: `database/supabase_tax_calculation_results.sql`

**Qué hace:**
- `CREATE TABLE IF NOT EXISTS public.invoice_tax_calculations` — tabla principal del motor tributario (resultados JSON, warnings, retenciones, bases gravables, flags de revisión)
- `CREATE TABLE IF NOT EXISTS public.invoice_line_classifications` — reservada para normalización futura (actualmente no se popula)
- `CREATE TABLE IF NOT EXISTS public.invoice_tax_calculation_groups` — reservada para normalización futura
- `ADD COLUMN IF NOT EXISTS invoice_id UUID` y `factura_dian_id UUID` en `invoice_tax_calculations`
- 8 índices de performance en `invoice_tax_calculations`
- COMMENTs en las tablas reservadas para documentar su estado

**Columnas clave de `invoice_tax_calculations`:**

| Columna | Tipo | Propósito |
|---------|------|-----------|
| `batch_id` | UUID | FK hacia batches |
| `invoice_id` | UUID | Referencia a invoices (sin FK formal) |
| `factura_dian_id` | UUID | Referencia a facturas_dian (sin FK formal) |
| `tenant_id` | UUID | Aislamiento multi-tenant |
| `result_json` | JSONB | Resultado completo: classified_lines[], groups[], manual_classification |
| `warnings_json` | JSONB | Advertencias del motor |
| `requires_review` | BOOLEAN | Flag para revisión manual |
| `confidence_score` | NUMERIC(4,3) | Confianza 0-1 del motor |

**Confirmación de idempotencia:** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.

---

### Script 4: `database/supabase_tenant_memory.sql`

**Qué hace:**
- `CREATE TABLE IF NOT EXISTS public.tenant_supplier_memory` — memoria de proveedores (NIT, clasificaciones aprendidas)
- `CREATE TABLE IF NOT EXISTS public.tenant_accounting_patterns` — patrones contables por tenant
- `CREATE TABLE IF NOT EXISTS public.tenant_reclassification_audit` — auditoría de reclasificaciones (incluye invoice_id, factura_dian_id, campo cambiado, valor anterior/nuevo)
- `CREATE TABLE IF NOT EXISTS public.accounting_movements_import` — importación de movimientos contables
- `CREATE TABLE IF NOT EXISTS public.tenant_tax_classification_memory` — memoria de clasificación tributaria
- Alteraciones a tablas existentes: `ADD COLUMN IF NOT EXISTS` y fix de CHECK constraint en `tenant_supplier_memory`

**Columnas clave de `tenant_reclassification_audit`:**

| Columna | Tipo | Propósito |
|---------|------|-----------|
| `invoice_id` | UUID | Referencia a invoices |
| `factura_dian_id` | UUID | Referencia a facturas_dian |
| `line_id` | TEXT | Línea de la factura reclasificada |
| `field_name` | TEXT | Campo reclasificado |
| `old_value_json` | JSONB | Valor anterior completo |
| `new_value_json` | JSONB | Valor nuevo completo |

**Confirmación de idempotencia:** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`.

---

### Script 5: `database/supabase_rls_policies.sql`

**Qué hace:**
- `CREATE OR REPLACE FUNCTION public.get_tenant_id()` — función que extrae tenant_id del JWT
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — habilita RLS en 8 tablas
- 22 políticas (patrón idempotente: `DROP POLICY IF EXISTS` + `CREATE POLICY`) para:
  - `invoice_tax_calculations`: select, insert, update por tenant
  - `invoice_line_classifications`: select, insert, update por tenant
  - `invoice_tax_calculation_groups`: select, insert, update por tenant
  - `tenant_supplier_memory`: select, insert, update por tenant
  - `tenant_tax_classification_memory`: select, insert, update por tenant
  - `tenant_reclassification_audit`: **solo select** (insert/update = service_role)
  - `tenant_accounting_patterns`: select, insert, update por tenant
  - `accounting_movements_import`: select, insert, update por tenant
- Queries de verificación al final del archivo (comentadas, ejecutar por separado)

**Confirmación de idempotencia:** `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` + `CREATE POLICY`. Seguro re-ejecutar completamente.

---

## 7. Queries de Verificación por Script

Ejecutar inmediatamente después de cada script, en el mismo SQL Editor.

### Post-Script 1: Verificar tablas base

```sql
-- 7.1a Confirmar que batches existe con columnas correctas
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'batches'
ORDER BY ordinal_position;

-- Columnas esperadas: id, filename, file_size, file_type, status,
-- total_invoices, processed_invoices, failed_invoices,
-- celery_task_id, error_message, created_at, updated_at

-- 7.1b Confirmar extensión de invoices
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'invoices'
  AND column_name IN ('batch_id', 'vendor_name', 'vendor_tax_id', 'total_amount', 'tax_amount', 'status')
ORDER BY column_name;
-- Esperado: 6 filas
```

### Post-Script 2: Verificar tablas DIAN

```sql
-- 7.2a Confirmar tablas DIAN
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('facturas_dian', 'facturas_dian_detalle')
ORDER BY table_name;
-- Esperado: 2 filas

-- 7.2b Confirmar función set_updated_at
SELECT proname FROM pg_proc
WHERE proname = 'set_updated_at' AND pronamespace::regnamespace::text = 'public';
-- Esperado: 1 fila
```

### Post-Script 3: Verificar tablas motor tributario

```sql
-- 7.3a Confirmar tablas del motor
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'invoice_tax_calculations',
    'invoice_line_classifications',
    'invoice_tax_calculation_groups'
  )
ORDER BY table_name;
-- Esperado: 3 filas

-- 7.3b Confirmar columnas invoice_id y factura_dian_id
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'invoice_tax_calculations'
  AND column_name IN ('invoice_id', 'factura_dian_id', 'result_json', 'tenant_id', 'requires_review', 'confidence_score')
ORDER BY column_name;
-- Esperado: 6 filas

-- 7.3c Confirmar índices del motor
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'invoice_tax_calculations'
ORDER BY indexname;
-- Esperado: mínimo 8 índices (idx_itc_*, idx_invoice_tax_calculations_*)
```

### Post-Script 4: Verificar tablas de memoria tenant

```sql
-- 7.4a Confirmar tablas de memoria
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'tenant_supplier_memory',
    'tenant_accounting_patterns',
    'tenant_reclassification_audit',
    'accounting_movements_import',
    'tenant_tax_classification_memory'
  )
ORDER BY table_name;
-- Esperado: 5 filas

-- 7.4b Confirmar columnas de auditoría extendidas
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tenant_reclassification_audit'
  AND column_name IN ('invoice_id', 'factura_dian_id', 'line_id', 'field_name', 'old_value_json', 'new_value_json')
ORDER BY column_name;
-- Esperado: 6 filas
```

### Post-Script 5: Verificar RLS y políticas

```sql
-- 7.5a Confirmar función get_tenant_id
SELECT proname, prosrc IS NOT NULL AS tiene_cuerpo
FROM pg_proc
WHERE proname = 'get_tenant_id'
  AND pronamespace::regnamespace::text = 'public';
-- Esperado: 1 fila, tiene_cuerpo = true

-- 7.5b Confirmar RLS habilitado en las 8 tablas del motor
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
-- Esperado: 8 filas, todas con rowsecurity = true

-- 7.5c Confirmar las 22 políticas creadas
SELECT tablename, policyname, cmd, roles
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
-- Esperado: 22 políticas
-- tenant_reclassification_audit SOLO debe tener política SELECT (1 política)
-- Las demás tablas deben tener 3 políticas cada una (select, insert, update)
-- EXCEPTO: invoice_line_classifications e invoice_tax_calculation_groups pueden
-- tener 3 cada una aunque actualmente no se populan
```

---

## 8. Verificación Final de Tablas

```sql
-- Resumen completo de todas las tablas del motor tributario
SELECT
  t.table_name,
  COUNT(c.column_name) AS total_columnas,
  pt.rowsecurity AS rls_activo
FROM information_schema.tables t
JOIN information_schema.columns c
  ON c.table_schema = t.table_schema AND c.table_name = t.table_name
LEFT JOIN pg_tables pt
  ON pt.schemaname = t.table_schema AND pt.tablename = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'batches',
    'invoices',
    'facturas_dian',
    'facturas_dian_detalle',
    'invoice_tax_calculations',
    'invoice_line_classifications',
    'invoice_tax_calculation_groups',
    'tenant_supplier_memory',
    'tenant_accounting_patterns',
    'tenant_reclassification_audit',
    'accounting_movements_import',
    'tenant_tax_classification_memory'
  )
GROUP BY t.table_name, pt.rowsecurity
ORDER BY t.table_name;
```

**Resultado esperado:**

| table_name | total_columnas | rls_activo |
|------------|----------------|------------|
| accounting_movements_import | ≥8 | true |
| batches | 12 | — |
| facturas_dian | ≥50 | — |
| facturas_dian_detalle | ≥15 | — |
| invoice_line_classifications | ≥5 | true |
| invoice_tax_calculation_groups | ≥5 | true |
| invoice_tax_calculations | ≥25 | true |
| invoices | ≥10 | — |
| tenant_accounting_patterns | ≥8 | true |
| tenant_reclassification_audit | ≥15 | true |
| tenant_supplier_memory | ≥12 | true |
| tenant_tax_classification_memory | ≥8 | true |

> Nota: `batches` e `invoices` y las tablas DIAN no tienen RLS en este runbook. El RLS de `batches` e `invoices` está gestionado por `supabase_batches_tenant_migration.sql` (scope separado). Las tablas DIAN pueden agregarse en un runbook posterior si se requiere.

---

## 9. Verificación Final de Columnas

```sql
-- Columnas críticas del motor tributario
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'invoice_tax_calculations'
      AND column_name IN (
        'id', 'batch_id', 'invoice_id', 'factura_dian_id', 'tenant_id',
        'invoice_number', 'supplier_nit', 'supplier_name', 'buyer_nit',
        'result_json', 'warnings_json', 'requires_review', 'confidence_score',
        'created_at', 'updated_at'
      )
    )
    OR
    (table_name = 'tenant_reclassification_audit'
      AND column_name IN (
        'id', 'tenant_id', 'invoice_id', 'factura_dian_id', 'line_id',
        'supplier_nit', 'supplier_name', 'field_name',
        'old_value_json', 'new_value_json', 'user_id', 'created_at'
      )
    )
    OR
    (table_name = 'tenant_supplier_memory'
      AND column_name IN (
        'id', 'tenant_id', 'supplier_nit', 'supplier_name',
        'account_code', 'account_name', 'cost_center',
        'source', 'metadata_json', 'updated_at'
      )
    )
  )
ORDER BY table_name, column_name;
```

---

## 10. Verificación Final de Índices

```sql
-- Todos los índices del motor tributario
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'invoice_tax_calculations',
    'tenant_supplier_memory',
    'tenant_reclassification_audit',
    'accounting_movements_import',
    'tenant_tax_classification_memory'
  )
ORDER BY tablename, indexname;
```

**Índices críticos esperados en `invoice_tax_calculations`:**

| Índice | Columnas |
|--------|----------|
| `idx_invoice_tax_calculations_tenant_batch` | (tenant_id, batch_id) |
| `idx_invoice_tax_calculations_tenant_invoice_number` | (tenant_id, invoice_number) |
| `idx_invoice_tax_calculations_tenant_supplier_nit` | (tenant_id, supplier_nit) |
| `idx_invoice_tax_calculations_tenant_buyer_nit` | (tenant_id, buyer_nit) |
| `idx_invoice_tax_calculations_tenant_requires_review` | (tenant_id, requires_review) |
| `idx_itc_invoice_id` | (invoice_id) |
| `idx_itc_factura_dian_id` | (factura_dian_id) |

---

## 11. Verificación Final de RLS

```sql
-- Estado completo de RLS por tabla
SELECT
  tablename,
  rowsecurity AS rls_enabled,
  forcerls AS force_rls
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

**Resultado esperado:** 8 filas, todas con `rls_enabled = true`.

---

## 12. Verificación Final de Policies

```sql
-- Detalle completo de políticas creadas
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual IS NOT NULL AS tiene_using,
  with_check IS NOT NULL AS tiene_with_check
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

**Conteo esperado de políticas por tabla:**

| Tabla | Políticas | Operaciones |
|-------|-----------|-------------|
| `invoice_tax_calculations` | 3 | SELECT, INSERT, UPDATE |
| `invoice_line_classifications` | 3 | SELECT, INSERT, UPDATE |
| `invoice_tax_calculation_groups` | 3 | SELECT, INSERT, UPDATE |
| `tenant_supplier_memory` | 3 | SELECT, INSERT, UPDATE |
| `tenant_tax_classification_memory` | 3 | SELECT, INSERT, UPDATE |
| `tenant_reclassification_audit` | **1** | **Solo SELECT** (service_role hace INSERT/UPDATE) |
| `tenant_accounting_patterns` | 3 | SELECT, INSERT, UPDATE |
| `accounting_movements_import` | 3 | SELECT, INSERT, UPDATE |
| **Total** | **22** | |

> `tenant_reclassification_audit` tiene solo 1 política intencionalmente. Los registros de auditoría son escritos únicamente por el servidor usando `service_role_key` que bypasa RLS. Un usuario autenticado puede leer su propio historial pero no puede modificarlo directamente.

---

## 13. Smoke Tests API Esperados

Una vez completada la ejecución de todos los scripts y confirmadas las verificaciones, ejecutar los siguientes smoke tests desde el cliente de API (Postman, curl, o el frontend de staging):

> **Prerequisito:** Obtener un JWT válido del ambiente de staging con un tenant de prueba.

### Test 1: Listar cálculos tributarios de un lote

```
GET /api/v1/invoices/batches/:batchId/tax-calculations
Authorization: Bearer <jwt_staging>
```

**Resultado esperado:**
- HTTP 200
- Body: `{ "data": [], "pagination": {...} }` (array vacío si no hay datos)
- NO debe retornar HTTP 500 ni error de schema

### Test 2: Filtrar por NIT proveedor

```
GET /api/v1/invoices/batches/:batchId/tax-calculations?nit=900123456
Authorization: Bearer <jwt_staging>
```

**Resultado esperado:**
- HTTP 200
- Solo registros del `tenant_id` del JWT (RLS activo)
- Si existen: JSON con campos `invoice_id`, `factura_dian_id`, `result_json`
- Si no existen: array vacío sin error

### Test 3: Filtrar por nombre proveedor

```
GET /api/v1/invoices/batches/:batchId/tax-calculations?supplierName=Acme
Authorization: Bearer <jwt_staging>
```

**Resultado esperado:**
- HTTP 200
- Búsqueda case-insensitive por `supplier_name`
- Respeta `tenant_id` del JWT (no expone datos de otros tenants)

### Test 4: Reclasificar factura completa

```
POST /api/v1/invoices/:invoiceId/reclassify
Authorization: Bearer <jwt_staging>
Content-Type: application/json

{
  "cost_or_expense": "expense",
  "cost_center": "ventas",
  "justification": "Smoke test staging"
}
```

**Resultado esperado:**
- HTTP 200 con el registro actualizado
- Genera entrada en `tenant_reclassification_audit`
- Actualiza `tenant_supplier_memory` con la nueva clasificación
- NO expone datos de otros tenants

### Test 5: Reclasificar línea individual

```
POST /api/v1/invoices/:invoiceId/lines/:lineId/reclassify
Authorization: Bearer <jwt_staging>
Content-Type: application/json

{
  "line_kind": "material",
  "cost_center": "produccion",
  "justification": "Smoke test línea staging"
}
```

**Resultado esperado:**
- HTTP 200
- Actualiza `result_json.classified_lines` para el `line_id` especificado
- Genera entrada en `tenant_reclassification_audit` con el `line_id`
- NO modifica otras líneas de la misma factura

### Comportamientos de Seguridad a Verificar

| Comportamiento | Cómo verificar |
|----------------|----------------|
| Cross-tenant bloqueado por RLS | Usar JWT de tenant A, buscar datos de tenant B → debe retornar array vacío |
| Auditoría no modificable por usuario | `POST /api/v1/invoices/:id/reclassify` no debe permitir borrar `tenant_reclassification_audit` |
| service_role bypasa RLS | Consultar `tenant_reclassification_audit` desde SQL Editor tras una reclasificación → debe haber registros |

---

## 14. Rollback Lógico

> ⚠️ Los scripts de este runbook son **completamente aditivos**. No hay rollback destructivo. La filosofía es: si algo falla, se corrige el script y se re-ejecuta (idempotencia garantizada).

### Escenario 1: Script falla a mitad de ejecución

**Acción:**
1. Revisar el mensaje de error en el SQL Editor.
2. Identificar qué statement falló (generalmente un constraint o dependencia).
3. Corregir el script si es necesario (generalmente innecesario por idempotencia).
4. Re-ejecutar el script completo desde el inicio.
5. Los statements ya ejecutados con `IF NOT EXISTS` se saltarán sin error.

### Escenario 2: Política RLS incorrecta creada

**Acción:**
1. Corregir el policy en `database/supabase_rls_policies.sql`.
2. Re-ejecutar `supabase_rls_policies.sql` completo.
3. El patrón `DROP POLICY IF EXISTS` + `CREATE POLICY` reemplaza cualquier política existente.

### Escenario 3: Columna agregada pero no necesaria

**Regla:** No hacer `DROP COLUMN` en staging/producción sin una migración aprobada.
- Dejar la columna. No causa daño.
- Registrar en Engram que la columna existe pero no se usa activamente.
- Planificar limpieza en un sprint futuro si es necesario.

### Escenario 4: Error de FK (foreign key violation)

**Causa más común:** Script ejecutado en orden incorrecto.
**Acción:**
1. Verificar qué tabla referenciada falta.
2. Ejecutar el script que crea esa tabla primero.
3. Re-ejecutar el script que falló.

### Escenario 5: Error grave que requiere limpieza de staging

**Solo en staging (NUNCA en producción):**
```sql
-- SOLO si hay que limpiar staging completamente para re-empezar
-- Ejecutar en orden inverso (primero las tablas con FK)
-- ⚠️ NUNCA ejecutar en producción
DROP TABLE IF EXISTS public.tenant_tax_classification_memory CASCADE;
DROP TABLE IF EXISTS public.accounting_movements_import CASCADE;
DROP TABLE IF EXISTS public.tenant_reclassification_audit CASCADE;
DROP TABLE IF EXISTS public.tenant_accounting_patterns CASCADE;
DROP TABLE IF EXISTS public.tenant_supplier_memory CASCADE;
DROP TABLE IF EXISTS public.invoice_tax_calculation_groups CASCADE;
DROP TABLE IF EXISTS public.invoice_line_classifications CASCADE;
DROP TABLE IF EXISTS public.invoice_tax_calculations CASCADE;
-- Luego re-ejecutar los 5 scripts en orden correcto
```

---

## 15. Criterios de Aprobación para Producción

La ejecución en staging está aprobada para promover a producción cuando se cumplan **TODOS** los siguientes criterios:

### Criterios Técnicos

| Criterio | Cómo verificar | Estado |
|----------|----------------|--------|
| 12 tablas existen con columnas correctas | Query sección 8 | ⬜ Pendiente |
| `invoice_id` y `factura_dian_id` presentes en `invoice_tax_calculations` | Query sección 9 | ⬜ Pendiente |
| 7+ índices creados en `invoice_tax_calculations` | Query sección 10 | ⬜ Pendiente |
| RLS habilitado en 8 tablas | Query sección 11 | ⬜ Pendiente |
| 22 políticas creadas correctamente | Query sección 12 | ⬜ Pendiente |
| `tenant_reclassification_audit` tiene solo 1 política (SELECT) | Query sección 12 | ⬜ Pendiente |

### Criterios de API

| Criterio | Cómo verificar | Estado |
|----------|----------------|--------|
| `GET tax-calculations` retorna HTTP 200 (array vacío si sin datos) | Test 1 sección 13 | ⬜ Pendiente |
| Filtros por NIT y nombre funcionan sin errores | Tests 2 y 3 sección 13 | ⬜ Pendiente |
| Reclasificación factura genera auditoría | Test 4 sección 13 | ⬜ Pendiente |
| Reclasificación línea genera auditoría con line_id | Test 5 sección 13 | ⬜ Pendiente |
| Cross-tenant bloqueado por RLS | Sección 13 tabla de seguridad | ⬜ Pendiente |

### Criterios de Calidad (ya cumplidos en local)

| Criterio | Estado |
|----------|--------|
| 141/141 tests pasan localmente | ✅ Confirmado (ecac162) |
| Build Next.js sin errores TypeScript | ✅ Confirmado (ecac162) |
| 0 patrones destructivos en SQL | ✅ Confirmado (este runbook) |
| Scripts idempotentes verificados | ✅ Confirmado (este runbook) |

### Proceso de Aprobación

1. Ejecutar todos los scripts en staging siguiendo este runbook.
2. Completar todas las verificaciones (secciones 7-12).
3. Ejecutar los 5 smoke tests (sección 13) y confirmar comportamientos de seguridad.
4. Marcar todos los criterios de la tabla como ✅.
5. Crear un tag en git: `git tag staging-validated-motor-tributario`.
6. Presentar este runbook completado al CTO/CEO para aprobación de producción.
7. El CEO aprueba la ejecución en producción en una ventana de mantenimiento acordada.

---

## 16. Informe para ChatGPT / Handoff

**Contexto para continuar desde otro cliente:**

```
Proyecto: ETL_V1 — Motor tributario Colombia (DIAN)
Stack: Next.js 15.5.18 / Supabase / TypeScript strict
Commit actual: ecac162 (main, local, NO pusheado)
Tests: 141/141 passing, build: ✓ Compiled successfully

Estado de la base de datos:
- 5 archivos SQL versionados en database/
- Todos idempotentes, 0 patrones destructivos
- Orden de ejecución: core_app → facturacion_dian → tax_calculation → tenant_memory → rls_policies

Tablas del motor tributario (nuevas en ecac162):
- invoice_tax_calculations: tabla activa con result_json JSONB + 8 índices
- invoice_line_classifications: reservada (no se popula aún)
- invoice_tax_calculation_groups: reservada (no se popula aún)
- tenant_supplier_memory: memoria proveedores con source + metadata_json
- tenant_accounting_patterns: patrones contables
- tenant_reclassification_audit: SOLO lectura para usuarios (service_role escribe)
- accounting_movements_import: importación movimientos
- tenant_tax_classification_memory: memoria clasificación tributaria

RLS: 22 políticas en 8 tablas, función public.get_tenant_id() basada en JWT

APIs relevantes:
- GET  /api/v1/invoices/batches/:batchId/tax-calculations (filtros: nit, supplierName)
- POST /api/v1/invoices/:invoiceId/reclassify
- POST /api/v1/invoices/:invoiceId/lines/:lineId/reclassify

Próximo paso: Ejecutar este runbook en staging y completar los criterios de aprobación (sección 15) para promover a producción.

Runbook completo: docs/runbook-sql-staging-motor-tributario.md
```

---

*Generado automáticamente por el motor de documentación ETL_V1 — Commit `ecac162`*
