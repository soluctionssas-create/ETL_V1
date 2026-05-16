-- =============================================================================
-- supabase_core_app_tables.sql
-- ETL_V1 — Tablas principales de la aplicación (Supabase producción)
--
-- Propósito:
--   Crea la tabla public.batches y completa la tabla public.invoices con las
--   columnas que el código productivo (apps/web) necesita.
--   Corrige 2 bloqueadores detectados durante la revisión go-live:
--     1. public.batches no existía en ningún SQL versionado de Supabase.
--     2. public.invoices creada por SUPABASE_AUTH_SETUP.md estaba incompleta.
--
-- Orden de ejecución (obligatorio):
--   1. SUPABASE_AUTH_SETUP.md                   ← crea tenants, users, invoices (base)
--   2. database/supabase_core_app_tables.sql     ← ESTE ARCHIVO
--   3. database/supabase_facturacion_dian_es.sql ← requiere que batches exista
--   4. database/supabase_batches_tenant_migration.sql
--   5. database/supabase_rls_policies.sql
--
-- ⛔ NUNCA ejecutar database/schema.sql en Supabase producción.
--   Ese archivo es el schema SQLAlchemy para FastAPI local (usa invoice_batches,
--   no batches) y romperá la base de datos de producción.
--
-- Idempotencia:
--   Todo este script usa CREATE TABLE IF NOT EXISTS y ADD COLUMN IF NOT EXISTS.
--   Es seguro ejecutarlo múltiples veces.
--
-- tenant_id en batches:
--   La columna tenant_id de public.batches NO se crea aquí.
--   Se agrega en database/supabase_batches_tenant_migration.sql
--   para mantener separadas la creación de la tabla y la migración multi-tenant.
-- =============================================================================

-- =============================================================================
-- PARTE 1: Crear public.batches
--
-- Esta tabla almacena los lotes de carga de facturas. Las columnas corresponden
-- al contrato real del Route Handler:
--   apps/web/app/api/v1/invoices/batches/route.ts
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.batches (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  filename            TEXT         NOT NULL,
  file_size           BIGINT       NOT NULL DEFAULT 0,
  file_type           TEXT         NOT NULL DEFAULT 'application/octet-stream',
  status              TEXT         NOT NULL DEFAULT 'uploaded',
  total_invoices      INTEGER      NOT NULL DEFAULT 0,
  processed_invoices  INTEGER      NOT NULL DEFAULT 0,
  failed_invoices     INTEGER      NOT NULL DEFAULT 0,
  celery_task_id      TEXT         NULL,
  error_message       TEXT         NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
  -- tenant_id se agrega en database/supabase_batches_tenant_migration.sql
);

-- Índices de public.batches
CREATE INDEX IF NOT EXISTS idx_batches_status     ON public.batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON public.batches(created_at DESC);

-- =============================================================================
-- PARTE 2: Completar public.invoices
--
-- SUPABASE_AUTH_SETUP.md crea invoices con las columnas base (id, tenant_id,
-- invoice_number, amount, currency, invoice_date). Estas columnas adicionales
-- son necesarias para los Route Handlers:
--   apps/web/app/api/v1/invoices/batches/route.ts (INSERT)
--   apps/web/app/api/v1/invoices/batches/[batchId]/invoices/route.ts (SELECT)
--
-- Columnas esperadas por el código:
--   batch_id, vendor_name, vendor_tax_id, total_amount, tax_amount, status
-- =============================================================================

-- FK hacia public.batches (requiere que batches exista, creada en Parte 1)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vendor_name TEXT;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vendor_tax_id TEXT;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS total_amount DECIMAL(19,2);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(19,2);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Índice en invoices.batch_id para las consultas por lote
CREATE INDEX IF NOT EXISTS idx_invoices_batch_id ON public.invoices(batch_id);

-- =============================================================================
-- Verificación rápida (opcional — ejecutar por separado si se quiere confirmar)
--
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND (
--     (table_name = 'batches'  AND column_name IN ('id','filename','file_size','file_type','status','total_invoices','processed_invoices','failed_invoices','celery_task_id','error_message','created_at','updated_at'))
--     OR
--     (table_name = 'invoices' AND column_name IN ('batch_id','vendor_name','vendor_tax_id','total_amount','tax_amount','status'))
--   )
-- ORDER BY table_name, column_name;
-- =============================================================================
