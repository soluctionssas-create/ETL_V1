-- =============================================================================
-- Migración: Memoria por empresa/tenant (aprendizaje de proveedores y patrones)
-- Archivo: database/supabase_tenant_memory.sql
-- Idempotente: segura para ejecutar múltiples veces (IF NOT EXISTS)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. tenant_supplier_memory
--    Memoria del comportamiento histórico por proveedor y tenant.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_supplier_memory (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid        NOT NULL,
  supplier_nit              text        NOT NULL,
  supplier_name             text,
  actividad_economica       text,

  -- Clasificación contable aprendida
  default_cost_or_expense   text        CHECK (default_cost_or_expense IN ('cost','expense','asset','unknown')),
  default_account_code      text,       -- cuenta de gasto/costo sugerida
  default_payable_account   text,       -- cuenta por pagar sugerida

  -- Retenciones aprendidas
  default_retefuente_concept  text,
  default_retefuente_account  text,
  default_reteica_city        text,
  default_reteica_kind        text      CHECK (default_reteica_kind IN ('service','purchase') OR default_reteica_kind IS NULL),

  -- Aprendizaje
  confidence                numeric(5,2) NOT NULL DEFAULT 0,
  times_seen                integer      NOT NULL DEFAULT 1,
  last_seen_at              timestamptz  NOT NULL DEFAULT now(),

  -- Clasificaciones manuales del usuario (refuerzan la memoria)
  manually_confirmed        boolean      NOT NULL DEFAULT false,
  confirmed_by              uuid,
  confirmed_at              timestamptz,

  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT uq_tsm_tenant_supplier UNIQUE (tenant_id, supplier_nit)
);

CREATE INDEX IF NOT EXISTS idx_tsm_tenant_id
  ON public.tenant_supplier_memory(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tsm_supplier_nit
  ON public.tenant_supplier_memory(supplier_nit);

CREATE INDEX IF NOT EXISTS idx_tsm_tenant_nit
  ON public.tenant_supplier_memory(tenant_id, supplier_nit);

-- Trigger updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tsm_updated_at'
  ) THEN
    CREATE TRIGGER trg_tsm_updated_at
    BEFORE UPDATE ON public.tenant_supplier_memory
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. tenant_accounting_patterns
--    Patrones contables aprendidos de movimientos históricos importados.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_accounting_patterns (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid        NOT NULL,
  supplier_nit              text,
  supplier_name             text,

  -- Patrón de cuentas
  account_code              text        NOT NULL,
  account_description       text,
  payable_account_code      text,

  -- Tipo de operación
  cost_or_expense           text        CHECK (cost_or_expense IN ('cost','expense','asset','unknown')),
  line_kind                 text        CHECK (line_kind IN ('purchase','service','mixed','unknown')),

  -- Estadísticas de uso
  avg_debit                 numeric(18,2),
  avg_credit                numeric(18,2),
  usage_count               integer      NOT NULL DEFAULT 1,
  last_used_at              timestamptz  NOT NULL DEFAULT now(),

  -- Impuestos históricos
  avg_iva_rate              numeric(10,6),
  avg_inc_rate              numeric(10,6),
  retefuente_concept_used   text,
  reteica_city_used         text,

  -- Confianza del patrón
  confidence                numeric(5,2) NOT NULL DEFAULT 0,

  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tap_tenant_id
  ON public.tenant_accounting_patterns(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tap_supplier_nit
  ON public.tenant_accounting_patterns(supplier_nit);

CREATE INDEX IF NOT EXISTS idx_tap_account_code
  ON public.tenant_accounting_patterns(account_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tap_updated_at'
  ) THEN
    CREATE TRIGGER trg_tap_updated_at
    BEFORE UPDATE ON public.tenant_accounting_patterns
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. tenant_reclassification_audit
--    Auditoría de reclasificaciones manuales del usuario.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_reclassification_audit (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  user_id           uuid,

  -- Referencia al ítem reclasificado
  calculation_id    uuid        REFERENCES public.invoice_tax_calculations(id) ON DELETE SET NULL,
  line_classification_id uuid   REFERENCES public.invoice_line_classifications(id) ON DELETE SET NULL,
  invoice_number    text,
  supplier_nit      text,

  -- Cambio
  field_changed     text        NOT NULL,  -- p.ej. "kind", "retefuente_concept", "reteica_city"
  old_value         text,
  new_value         text,
  reason            text,                  -- justificación del usuario

  -- Actualización de memoria
  update_memory     boolean      NOT NULL DEFAULT true,

  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tra_tenant_id
  ON public.tenant_reclassification_audit(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tra_user_id
  ON public.tenant_reclassification_audit(user_id);

CREATE INDEX IF NOT EXISTS idx_tra_supplier_nit
  ON public.tenant_reclassification_audit(supplier_nit);

-- -----------------------------------------------------------------------------
-- 4. accounting_movements_import
--    Movimientos contables históricos importados (CSV/XLSX).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_movements_import (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  import_batch_id   uuid        NOT NULL,  -- ID del lote de importación

  fecha             date,
  cuenta_contable   text,
  nit               text,
  nombre_proveedor  text,
  descripcion       text,
  debito            numeric(18,2),
  credito           numeric(18,2),
  centro_costo      text,
  tercero           text,
  documento         text,
  base              numeric(18,2),
  iva               numeric(18,2),
  retefuente        numeric(18,2),
  reteica           numeric(18,2),
  cuenta_por_pagar  text,

  -- Metadatos de la importación
  raw_row_json      jsonb,        -- fila original sin procesar
  processed         boolean      NOT NULL DEFAULT false,
  processed_at      timestamptz,

  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ami_tenant_id
  ON public.accounting_movements_import(tenant_id);

CREATE INDEX IF NOT EXISTS idx_ami_import_batch
  ON public.accounting_movements_import(import_batch_id);

CREATE INDEX IF NOT EXISTS idx_ami_nit
  ON public.accounting_movements_import(nit);

CREATE INDEX IF NOT EXISTS idx_ami_cuenta
  ON public.accounting_movements_import(cuenta_contable);

-- =============================================================================
-- Migración adicional: Task 6 — Reclasificación manual + auditoría + memoria
-- tenant_tax_classification_memory (nueva tabla)
-- Columnas faltantes en tenant_supplier_memory, tenant_reclassification_audit
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5. tenant_tax_classification_memory
--    Aprendizaje por patrón de descripción de ítem + proveedor.
--    Permite que el motor reutilice clasificaciones confirmadas manualmente.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_tax_classification_memory (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  supplier_nit          text,
  description_pattern   text        NOT NULL,  -- normalizado: sin tildes, sin 6+dígitos, max 120
  kind                  text        CHECK (kind IN ('purchase','service','mixed','unknown') OR kind IS NULL),
  account_code          text,
  retefuente_concept    text,
  reteica_kind          text        CHECK (reteica_kind IN ('service','purchase') OR reteica_kind IS NULL),
  confidence            numeric(5,2) NOT NULL DEFAULT 0,
  times_seen            integer      NOT NULL DEFAULT 1,
  last_seen_at          timestamptz  NOT NULL DEFAULT now(),
  metadata_json         jsonb,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_ttcm_tenant_supplier_pattern
    UNIQUE (tenant_id, supplier_nit, description_pattern)
);

CREATE INDEX IF NOT EXISTS idx_ttcm_tenant_id
  ON public.tenant_tax_classification_memory(tenant_id);

CREATE INDEX IF NOT EXISTS idx_ttcm_supplier_nit
  ON public.tenant_tax_classification_memory(supplier_nit);

CREATE INDEX IF NOT EXISTS idx_ttcm_tenant_supplier
  ON public.tenant_tax_classification_memory(tenant_id, supplier_nit);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_ttcm_updated_at'
       AND tgrelid = 'public.tenant_tax_classification_memory'::regclass
  ) THEN
    CREATE TRIGGER trg_ttcm_updated_at
      BEFORE UPDATE ON public.tenant_tax_classification_memory
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Columnas adicionales en tenant_supplier_memory
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenant_supplier_memory
  ADD COLUMN IF NOT EXISTS source        text,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb;

-- Corregir CHECK constraint para incluir 'liability'
ALTER TABLE public.tenant_supplier_memory
  DROP CONSTRAINT IF EXISTS tenant_supplier_memory_default_cost_or_expense_check;

ALTER TABLE public.tenant_supplier_memory
  ADD CONSTRAINT tenant_supplier_memory_default_cost_or_expense_check
  CHECK (
    default_cost_or_expense IN ('cost','expense','asset','liability','unknown')
    OR default_cost_or_expense IS NULL
  );

-- -----------------------------------------------------------------------------
-- Columnas adicionales en tenant_reclassification_audit
-- El esquema original tiene field_changed/old_value/new_value (texto).
-- Agregamos las nuevas columnas tipadas; las antiguas quedan como fallback.
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenant_reclassification_audit
  ADD COLUMN IF NOT EXISTS invoice_id      uuid,
  ADD COLUMN IF NOT EXISTS factura_dian_id uuid,
  ADD COLUMN IF NOT EXISTS line_id         text,
  ADD COLUMN IF NOT EXISTS supplier_name   text,
  ADD COLUMN IF NOT EXISTS field_name      text,
  ADD COLUMN IF NOT EXISTS old_value_json  jsonb,
  ADD COLUMN IF NOT EXISTS new_value_json  jsonb;

-- Hacer nullable field_changed para que las nuevas inserciones no fallen
ALTER TABLE public.tenant_reclassification_audit
  ALTER COLUMN field_changed DROP NOT NULL;

-- Índices para consultas de auditoría por factura/cálculo
CREATE INDEX IF NOT EXISTS idx_tra_invoice_id
  ON public.tenant_reclassification_audit(invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tra_calculation_id
  ON public.tenant_reclassification_audit(calculation_id)
  WHERE calculation_id IS NOT NULL;

-- =============================================================================
-- FIN MIGRACIÓN supabase_tenant_memory.sql
-- =============================================================================
