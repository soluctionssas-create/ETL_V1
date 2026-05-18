-- =============================================================================
-- Migración: Motor tributario — tablas de cálculo de retenciones
-- Archivo: database/supabase_tax_calculation_results.sql
-- Idempotente: segura para ejecutar múltiples veces (IF NOT EXISTS)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. invoice_tax_calculations
--    Una fila por factura procesada por el motor tributario.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_tax_calculations (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid        NOT NULL,
  batch_id                  uuid,
  invoice_number            text,
  supplier_nit              text,
  supplier_name             text,
  buyer_nit                 text,
  buyer_name                text,
  city                      text,

  -- Totales financieros
  subtotal                  numeric(18,2) NOT NULL DEFAULT 0,
  iva_total                 numeric(18,2) NOT NULL DEFAULT 0,
  inc_total                 numeric(18,2) NOT NULL DEFAULT 0,
  total_invoice             numeric(18,2) NOT NULL DEFAULT 0,

  -- Retenciones calculadas por el motor
  retefuente_calculated     numeric(18,2) NOT NULL DEFAULT 0,
  reteica_calculated        numeric(18,2) NOT NULL DEFAULT 0,
  reteiva_calculated        numeric(18,2) NOT NULL DEFAULT 0,

  -- Retenciones reportadas en la factura
  retefuente_reported       numeric(18,2) NOT NULL DEFAULT 0,
  reteica_reported          numeric(18,2) NOT NULL DEFAULT 0,
  reteiva_reported          numeric(18,2) NOT NULL DEFAULT 0,

  -- Diferencias (calculated - reported)
  retefuente_difference     numeric(18,2) NOT NULL DEFAULT 0,
  reteica_difference        numeric(18,2) NOT NULL DEFAULT 0,
  reteiva_difference        numeric(18,2) NOT NULL DEFAULT 0,

  -- Control
  requires_review           boolean       NOT NULL DEFAULT false,
  warnings_json             jsonb         NOT NULL DEFAULT '[]'::jsonb,
  result_json               jsonb         NOT NULL DEFAULT '{}'::jsonb,

  created_at                timestamptz   NOT NULL DEFAULT now(),
  updated_at                timestamptz   NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_itc_tenant_id
  ON public.invoice_tax_calculations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_itc_batch_id
  ON public.invoice_tax_calculations(batch_id);

CREATE INDEX IF NOT EXISTS idx_itc_supplier_nit
  ON public.invoice_tax_calculations(supplier_nit);

CREATE INDEX IF NOT EXISTS idx_itc_invoice_number
  ON public.invoice_tax_calculations(invoice_number);

CREATE INDEX IF NOT EXISTS idx_itc_requires_review
  ON public.invoice_tax_calculations(requires_review)
  WHERE requires_review = true;

CREATE INDEX IF NOT EXISTS idx_itc_result_json_gin
  ON public.invoice_tax_calculations USING gin(result_json);

-- -----------------------------------------------------------------------------
-- 2. invoice_tax_calculation_groups
--    Una fila por grupo tributario (ReteFuente, ReteICA, ReteIVA).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_tax_calculation_groups (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id    uuid        NOT NULL
                    REFERENCES public.invoice_tax_calculations(id) ON DELETE CASCADE,
  tenant_id         uuid        NOT NULL,

  tax_type          text        NOT NULL CHECK (tax_type IN ('retefuente','reteica','reteiva')),
  group_key         text        NOT NULL,
  concept           text,
  account_code      text,
  legal_reference   text,

  base              numeric(18,2) NOT NULL DEFAULT 0,
  threshold_base    numeric(18,2) NOT NULL DEFAULT 0,
  rate              numeric(10,6) NOT NULL DEFAULT 0,
  calculated_amount numeric(18,2) NOT NULL DEFAULT 0,
  applies           boolean       NOT NULL DEFAULT false,

  line_numbers_json jsonb         NOT NULL DEFAULT '[]'::jsonb,
  reasons_json      jsonb         NOT NULL DEFAULT '[]'::jsonb,

  created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itcg_calculation_id
  ON public.invoice_tax_calculation_groups(calculation_id);

CREATE INDEX IF NOT EXISTS idx_itcg_tenant_id
  ON public.invoice_tax_calculation_groups(tenant_id);

CREATE INDEX IF NOT EXISTS idx_itcg_tax_type
  ON public.invoice_tax_calculation_groups(tax_type);

-- -----------------------------------------------------------------------------
-- 3. invoice_line_classifications
--    Una fila por línea clasificada de la factura.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_line_classifications (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id    uuid        NOT NULL
                    REFERENCES public.invoice_tax_calculations(id) ON DELETE CASCADE,
  tenant_id         uuid        NOT NULL,

  line_id           text        NOT NULL,
  source_line_number integer    NOT NULL,
  description       text,
  code              text,
  quantity          numeric(18,4) NOT NULL DEFAULT 0,
  unit_price        numeric(18,4) NOT NULL DEFAULT 0,
  line_base         numeric(18,2) NOT NULL DEFAULT 0,
  iva_amount        numeric(18,2) NOT NULL DEFAULT 0,
  iva_rate          numeric(10,6) NOT NULL DEFAULT 0,
  inc_amount        numeric(18,2) NOT NULL DEFAULT 0,
  inc_rate          numeric(10,6) NOT NULL DEFAULT 0,

  kind              text        NOT NULL CHECK (kind IN ('purchase','service','mixed','unknown')),
  retefuente_concept text,
  retefuente_account text,
  reteica_city      text,
  reteica_kind      text        CHECK (reteica_kind IN ('service','purchase') OR reteica_kind IS NULL),

  confidence        numeric(5,2) NOT NULL DEFAULT 0,
  reasons_json      jsonb        NOT NULL DEFAULT '[]'::jsonb,
  requires_review   boolean      NOT NULL DEFAULT false,

  -- Reclasificación manual
  reclassified_kind       text,
  reclassified_concept    text,
  reclassified_account    text,
  reclassified_by         uuid,
  reclassified_at         timestamptz,
  reclassification_reason text,

  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ilc_calculation_id
  ON public.invoice_line_classifications(calculation_id);

CREATE INDEX IF NOT EXISTS idx_ilc_tenant_id
  ON public.invoice_line_classifications(tenant_id);

CREATE INDEX IF NOT EXISTS idx_ilc_requires_review
  ON public.invoice_line_classifications(requires_review)
  WHERE requires_review = true;

-- =============================================================================
-- Migración adicional: Task 7 Estabilización
-- Columnas FK, índices compuestos tenant-aware y documentación de tablas futuras
-- Idempotente: segura para ejecutar múltiples veces (IF NOT EXISTS / IF EXISTS)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- invoice_tax_calculations: agregar FKs pendientes
-- invoice_id → references public.invoices(id) — vincula al registro de la factura
-- factura_dian_id → references public.facturas_dian(id) — vincula a la factura DIAN
-- No se agregan como FK con REFERENCES para evitar dependencias de orden de ejecución.
-- Se documentan como UUIDs sin constraint FK; la integridad se garantiza por código.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoice_tax_calculations
  ADD COLUMN IF NOT EXISTS invoice_id      uuid,
  ADD COLUMN IF NOT EXISTS factura_dian_id uuid;

-- Índices para las nuevas columnas FK
CREATE INDEX IF NOT EXISTS idx_itc_invoice_id
  ON public.invoice_tax_calculations(invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_itc_factura_dian_id
  ON public.invoice_tax_calculations(factura_dian_id)
  WHERE factura_dian_id IS NOT NULL;

-- Índices compuestos tenant-aware (mejoran consultas multi-tenant del endpoint
-- GET /api/v1/invoices/batches/:batchId/tax-calculations con filtros combinados)
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

-- -----------------------------------------------------------------------------
-- invoice_line_classifications y invoice_tax_calculation_groups:
-- TABLAS FUTURAS — no se pueblan actualmente.
-- El resultado principal (líneas y grupos) vive en result_json (JSONB) de
-- invoice_tax_calculations. Estas tablas son candidatas para normalización futura.
-- NO eliminar. NO usar en producción hasta definir pipeline de migración.
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.invoice_line_classifications IS
  'Tabla reservada para normalización futura. '
  'Actualmente los datos de líneas viven en invoice_tax_calculations.result_json (JSONB). '
  'No usar en producción hasta definir el pipeline de migración de líneas.';

COMMENT ON TABLE public.invoice_tax_calculation_groups IS
  'Tabla reservada para normalización futura. '
  'Actualmente los grupos tributarios viven en invoice_tax_calculations.result_json (JSONB). '
  'No usar en producción hasta definir el pipeline de migración de grupos.';

-- =============================================================================
-- FIN MIGRACIÓN supabase_tax_calculation_results.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4. Trigger: updated_at automático en invoice_tax_calculations
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_itc_updated_at'
  ) THEN
    CREATE TRIGGER trg_itc_updated_at
    BEFORE UPDATE ON public.invoice_tax_calculations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- =============================================================================
-- FIN MIGRACIÓN supabase_tax_calculation_results.sql
-- =============================================================================
