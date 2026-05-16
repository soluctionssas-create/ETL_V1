# Guía de Ejecución SQL en Supabase — ETL_V1

## Índice
1. [Prerrequisitos](#prerrequisitos)
2. [Archivos SQL y orden de ejecución](#archivos-sql-y-orden-de-ejecución)
3. [Cómo ejecutar en Supabase SQL Editor](#cómo-ejecutar-en-supabase-sql-editor)
4. [Paso a paso: migración y RLS](#paso-a-paso-migración-y-rls)
5. [Verificación por tabla](#verificación-por-tabla)
6. [Backfill de `batches.tenant_id`](#backfill-de-batchestenant_id)
7. [Advertencias importantes](#advertencias-importantes)

---

## Prerrequisitos

- Acceso al proyecto de Supabase con rol `service_role` o superior.
- Haber ejecutado `SUPABASE_AUTH_SETUP.md` (crea `tenants`, `users`, `invoices` base).
- Haber ejecutado `database/supabase_core_app_tables.sql` (crea `batches`, completa `invoices`).
- Haber ejecutado `database/supabase_facturacion_dian_es.sql` (crea `facturas_dian`, `facturas_dian_detalle`).
- La columna `tenant_id` en `batches` **no existe aún** — se crea en este proceso.

---

## Archivos SQL y orden de ejecución

| Orden | Archivo | Propósito |
|-------|---------|-----------|
| 1 | `SUPABASE_AUTH_SETUP.md` (SQL block) | Crea `tenants`, `users`, `invoices` (columnas base) |
| 2 | `database/supabase_core_app_tables.sql` | **NUEVO** — Crea `batches` + completa `invoices` |
| 3 | `database/supabase_facturacion_dian_es.sql` | Crea `facturas_dian`, `facturas_dian_detalle` + parches DIAN |
| 4 | `database/supabase_batches_tenant_migration.sql` | Agrega `tenant_id` a `batches` |
| 5 | `database/supabase_rls_policies.sql` | Activa RLS y define policies por tenant |

> ⛔ **NUNCA ejecutar** `database/schema.sql` en Supabase producción.
> Ese archivo es el schema del backend Python (usa `invoice_batches`, no `batches`)
> y romperá la base de datos de producción.

### Qué soluciona `database/supabase_core_app_tables.sql`

Este archivo fue creado para corregir dos bloqueadores detectados en la revisión go-live:

**Bloqueador 1 — `public.batches` no existía en ningún SQL versionado de Supabase.**
- `database/supabase_facturacion_dian_es.sql` tiene una FK `batch_id → public.batches(id)`.
  Sin la tabla `batches`, ese script falla con `relation "public.batches" does not exist`.
- El Route Handler `apps/web/app/api/v1/invoices/batches/route.ts` hace `.from("batches")`
  con las columnas: `id, filename, file_size, file_type, status, total_invoices,
  processed_invoices, failed_invoices, celery_task_id, error_message, tenant_id`.
- **Solución:** `supabase_core_app_tables.sql` crea la tabla con esas columnas exactas.

**Bloqueador 2 — `public.invoices` de `SUPABASE_AUTH_SETUP.md` estaba incompleta.**
- `SUPABASE_AUTH_SETUP.md` solo crea: `id, tenant_id, invoice_number, amount, currency, invoice_date`.
- El Route Handler inserta y consulta: `batch_id, vendor_name, vendor_tax_id, total_amount,
  tax_amount, status`.
- Sin estas columnas el INSERT falla con `column "batch_id" does not exist`.
- **Solución:** `supabase_core_app_tables.sql` agrega esas columnas con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

---

## Cómo ejecutar en Supabase SQL Editor

1. Abrir [https://app.supabase.com](https://app.supabase.com)
2. Seleccionar el proyecto ETL_V1.
3. En el menú lateral izquierdo: **SQL Editor** → **New query**.
4. Copiar y pegar el contenido del archivo SQL.
5. Revisar el script completo antes de ejecutar.
6. Hacer clic en **Run** (o `Ctrl+Enter` / `Cmd+Enter`).
7. Verificar que el output diga `Success. No rows returned` o muestre los resultados esperados.

---

## Paso a paso: migración y RLS

### Paso 1 — Tablas base (Auth + tenants + users + invoices base)

**Fuente:** `SUPABASE_AUTH_SETUP.md` → sección "Paso 1: Crear Tablas"

Crea: `tenants`, `users`, `invoices` (columnas base).
Las columnas adicionales de `invoices` se agregan en el Paso 2.

### Paso 2 — Tablas principales (batches + completar invoices)

**Archivo:** `database/supabase_core_app_tables.sql`

Este script (nuevo — corrige 2 bloqueadores go-live):
- Crea `public.batches` con las columnas del contrato Route Handler
- Agrega las columnas faltantes a `public.invoices`:
  `batch_id`, `vendor_name`, `vendor_tax_id`, `total_amount`, `tax_amount`, `status`

> **Debe ejecutarse ANTES de `supabase_facturacion_dian_es.sql`** porque ese
> archivo tiene una FK `batch_id → public.batches(id)`.

**Verificar resultado:**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'batches';
-- Debe retornar 1 fila

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invoices'
  AND column_name IN ('batch_id', 'vendor_name', 'total_amount', 'status');
-- Debe retornar 4 filas
```

### Paso 3 — Tablas DIAN

**Archivo:** `database/supabase_facturacion_dian_es.sql`

Crea `facturas_dian` y `facturas_dian_detalle`. Aplica parches idempotentes
(`fuente_archivo`, `tot_iva`). Requiere que `public.batches` exista (Paso 2).

### Paso 4 — Migración `batches.tenant_id`

**Archivo:** `database/supabase_batches_tenant_migration.sql`

Este script:
- Agrega `ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS tenant_id uuid`
- Crea FK a `public.tenants(id) ON DELETE SET NULL`
- Crea índice `idx_batches_tenant_id`
- Muestra registros sin `tenant_id` para identificar qué requiere backfill

**Verificar resultado:**
```sql
SELECT
  COUNT(*) FILTER (WHERE tenant_id IS NULL) AS sin_tenant,
  COUNT(*) FILTER (WHERE tenant_id IS NOT NULL) AS con_tenant,
  COUNT(*) AS total
FROM public.batches;
```

**Si hay registros sin tenant_id** → ver sección [Backfill](#backfill-de-batchestenant_id).

### Paso 5 — Políticas RLS

**Archivo:** `database/supabase_rls_policies.sql`

Este script:
1. Crea la función `auth.get_tenant_id()` (SECURITY DEFINER)
2. Activa RLS en todas las tablas relevantes
3. Define policies SELECT/INSERT/UPDATE por `tenant_id = auth.get_tenant_id()`

**Pre-requisito**: La columna `batches.tenant_id` debe existir (Paso 4).
Si se ejecuta antes del Paso 4, las policies de `batches` fallarán.

---

## Verificación por tabla

Ejecutar estas queries después de completar los 3 pasos:

```sql
-- 1. Confirmar que RLS está habilitado en todas las tablas
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('batches', 'invoices', 'facturas_dian', 'facturas_dian_detalle');
-- rowsecurity debe ser TRUE en todas

-- 2. Listar todas las policies activas
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('batches', 'invoices', 'facturas_dian', 'facturas_dian_detalle')
ORDER BY tablename, policyname;

-- 3. Confirmar columna tenant_id en batches
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'batches'
  AND column_name = 'tenant_id';
-- Debe retornar 1 fila con data_type = 'uuid'

-- 4. Confirmar FK de batches.tenant_id → tenants.id
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'batches'
  AND tc.constraint_type = 'FOREIGN KEY';
-- Debe mostrar fk_batches_tenant_id → tenants.id
```

---

## Backfill de `batches.tenant_id`

La tabla `batches` no tiene `user_id` ni columna que relacione directamente
un batch con un tenant. Por este motivo, el backfill no puede ser automático
de forma segura en entornos multi-tenant.

### Entorno single-tenant (caso actual de ETL_V1 en producción)

Si hay exactamente 1 tenant registrado en la tabla `tenants`, todos los batches
existentes pertenecen a ese tenant. Ejecutar:

```sql
-- Verificar primero que hay exactamente 1 tenant
SELECT COUNT(*) FROM public.tenants;  -- debe ser 1

-- Si COUNT = 1, ejecutar el backfill:
UPDATE public.batches b
SET tenant_id = (SELECT id FROM public.tenants ORDER BY created_at LIMIT 1)
WHERE b.tenant_id IS NULL;

-- Verificar resultado
SELECT
  COUNT(*) FILTER (WHERE tenant_id IS NULL) AS sin_tenant,
  COUNT(*) FILTER (WHERE tenant_id IS NOT NULL) AS con_tenant
FROM public.batches;
-- sin_tenant debe ser 0
```

### Entorno multi-tenant

Identificar los batches sin tenant y asignarlos manualmente según el contexto
de cada registro (por ejemplo, cruzando con la tabla `invoices`):

```sql
-- Ver batches sin tenant, con info de sus invoices para identificar a qué tenant pertenecen
SELECT
  b.id AS batch_id,
  b.filename,
  b.created_at,
  i.tenant_id AS tenant_from_invoice
FROM public.batches b
LEFT JOIN public.invoices i ON i.batch_id = b.id
WHERE b.tenant_id IS NULL
GROUP BY b.id, b.filename, b.created_at, i.tenant_id
LIMIT 50;
```

---

## Advertencias importantes

### ⚠️ NO ejecutar `schema.sql` en Supabase

El archivo `database/schema.sql` define el esquema para el backend Python local
y usa una tabla llamada `invoice_batches` (NO `batches`). Ejecutarlo en Supabase
producción generará tablas duplicadas o incorrectas.

### ⚠️ Antes de activar RLS en producción

Las policies de RLS bloquean acceso de la `authenticated` role. El código Next.js
usa `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS), por lo que no se verá afectado.
Sin embargo, si hay otras aplicaciones o herramientas (Supabase Studio, apps admin)
que usen la `anon` o `authenticated` key, verificar que puedan acceder correctamente
antes de activar RLS.

### ⚠️ Batches con `tenant_id = NULL` después de activar RLS

Con las policies activas, los batches con `tenant_id = NULL` serán invisibles para
usuarios autenticados (la condición `tenant_id = auth.get_tenant_id()` nunca se
cumple si tenant_id es NULL). Completar el backfill antes de activar RLS en
producción si los usuarios necesitan ver los batches existentes.

### ⚠️ Función `auth.get_tenant_id()`

La función usa `SECURITY DEFINER` para acceder a `public.users` sin que el
usuario autenticado necesite SELECT sobre esa tabla. Si la tabla `public.users`
tiene otro nombre, actualizar la función en `supabase_rls_policies.sql` antes
de ejecutarlo.
