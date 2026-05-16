-- =============================================================================
-- Migración: Agregar tenant_id a public.batches — ETL_V1
-- Generado: 2026-05-15
--
-- ORDEN DE EJECUCIÓN OBLIGATORIO:
--   1. Este archivo primero.
--   2. Luego columnas de supabase_facturacion_dian_es.sql (si no se ejecutaron).
--   3. Luego supabase_rls_policies.sql.
--
-- Este script es IDEMPOTENTE: se puede ejecutar múltiples veces de forma segura.
-- NO elimina datos. NO agrega NOT NULL sin backfill previo.
-- =============================================================================


-- =============================================================================
-- PASO 1: Agregar columna tenant_id
-- Se usa UUID nullable para no romper registros existentes.
-- NOT NULL se puede agregar DESPUÉS del backfill cuando todos los registros
-- tengan tenant_id asignado (ver PASO 4 antes de hacerlo).
-- =============================================================================
ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Nota: NO se agrega REFERENCES aquí todavía porque puede haber registros
-- existentes con tenant_id NULL que fallarían la constraint.
-- La FK se agrega en PASO 3, después del backfill.


-- =============================================================================
-- PASO 2: Índice para consultas por tenant
-- Creado antes del backfill para acelerar el UPDATE masivo.
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_batches_tenant_id
  ON public.batches(tenant_id);


-- =============================================================================
-- PASO 3: FK hacia public.tenants
-- La tabla tenants es la que usa el código Next.js (resolveTenantId consulta
-- public.tenants para obtener el id del tenant activo).
-- Se usa ADD CONSTRAINT IF NOT EXISTS pattern vía DO block para idempotencia.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_batches_tenant_id'
      AND table_schema = 'public'
      AND table_name = 'batches'
  ) THEN
    -- Solo agregar FK si la columna ya tiene datos o está vacía.
    -- Si hay registros con tenant_id NULL, la FK aplica solo a valores no nulos (nullable).
    ALTER TABLE public.batches
      ADD CONSTRAINT fk_batches_tenant_id
      FOREIGN KEY (tenant_id)
      REFERENCES public.tenants(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;


-- =============================================================================
-- PASO 4: BACKFILL — Asignar tenant_id a batches existentes
--
-- IMPORTANTE: La tabla batches NO tiene user_id ni columna que relacione
-- directamente un batch con un tenant. El backfill automático no es seguro
-- porque podría asignar el tenant equivocado en entornos multi-tenant.
--
-- BACKFILL MANUAL REQUIRED:
--   En un entorno de un solo tenant (caso actual de ETL_V1 en producción),
--   todos los batches sin tenant_id pertenecen al único tenant existente.
--   Ejecuta la siguiente query SOLO si confirmas que hay exactamente un tenant:
--
--   UPDATE public.batches b
--   SET tenant_id = (SELECT id FROM public.tenants ORDER BY created_at LIMIT 1)
--   WHERE b.tenant_id IS NULL;
--
--   Verifica antes con:
--   SELECT COUNT(*) FROM public.tenants;  -- debe ser 1 para ejecutar el UPDATE
--
-- En entornos multi-tenant el backfill debe hacerse manualmente campo a campo
-- o manteniendo NULL temporal hasta que el usuario lo asigne desde la UI.
-- =============================================================================
-- El backfill automático queda COMENTADO intencionalmente.
-- Descomenta y ejecuta SOLO después de confirmar el entorno single-tenant:
--
-- UPDATE public.batches b
-- SET tenant_id = (SELECT id FROM public.tenants ORDER BY created_at LIMIT 1)
-- WHERE b.tenant_id IS NULL;


-- =============================================================================
-- PASO 5: Consulta de verificación
-- Ejecutar después de la migración y del backfill para confirmar el estado.
-- =============================================================================
SELECT
  id,
  filename,
  tenant_id,
  CASE WHEN tenant_id IS NULL THEN 'SIN TENANT — requiere backfill' ELSE 'OK' END AS estado_tenant
FROM public.batches
WHERE tenant_id IS NULL
LIMIT 20;

-- Ver resumen general:
-- SELECT
--   COUNT(*) FILTER (WHERE tenant_id IS NULL) AS sin_tenant,
--   COUNT(*) FILTER (WHERE tenant_id IS NOT NULL) AS con_tenant,
--   COUNT(*) AS total
-- FROM public.batches;
