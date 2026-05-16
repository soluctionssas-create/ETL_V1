-- =============================================================================
-- Migración: Columnas de extracción canónica DIAN
-- Idempotente: usa ADD COLUMN IF NOT EXISTS → seguro re-ejecutar
-- NO incluye cambios de RLS ni tenant_id (ya gestionado por FK a facturas_dian)
-- =============================================================================

-- ─── facturas_dian: columnas JSONB de trazabilidad ───────────────────────────
ALTER TABLE public.facturas_dian
  ADD COLUMN IF NOT EXISTS canonical_invoice_json      JSONB,
  ADD COLUMN IF NOT EXISTS extraction_payload_json     JSONB,
  ADD COLUMN IF NOT EXISTS extraction_warnings_json    JSONB,
  ADD COLUMN IF NOT EXISTS fuente_extraccion           TEXT,
  ADD COLUMN IF NOT EXISTS confianza_extraccion        NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS version_parser              TEXT;

-- Índice GIN para búsquedas dentro de canonical_invoice_json (opcional, recomendado)
CREATE INDEX IF NOT EXISTS idx_facturas_dian_canonical_gin
  ON public.facturas_dian USING gin (canonical_invoice_json);

-- ─── facturas_dian_detalle: columnas adicionales de línea ────────────────────
ALTER TABLE public.facturas_dian_detalle
  ADD COLUMN IF NOT EXISTS detalle_total_linea                    NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS detalle_base_gravable                  NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS detalle_notas                          TEXT,
  ADD COLUMN IF NOT EXISTS detalle_propiedades_adicionales_json   JSONB;

-- =============================================================================
-- Fin de migración
-- Para aplicar en Supabase Dashboard → SQL Editor → pegar y ejecutar
-- NO ejecutar en local con database/schema.sql (ese es solo para referencia)
-- =============================================================================
