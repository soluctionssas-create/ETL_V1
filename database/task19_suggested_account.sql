-- =============================================================================
-- Task 19: Motor de clasificación contable granular
-- Archivo: database/task19_suggested_account.sql
-- Idempotente: segura para ejecutar múltiples veces (ALTER ... ADD COLUMN IF NOT EXISTS)
-- Aplica a: staging (skrjyrnprmoattwlitzs) y producción (pvzchcscuqpzuaxbfihh)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- invoice_line_classifications: agregar campos de cuenta sugerida
-- Estos campos son calculados por el motor y persistidos para auditoría.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoice_line_classifications
  ADD COLUMN IF NOT EXISTS suggested_account_code    text,
  ADD COLUMN IF NOT EXISTS suggested_account_name    text,
  ADD COLUMN IF NOT EXISTS payable_account_code      text,
  ADD COLUMN IF NOT EXISTS cost_or_expense           text
    CHECK (cost_or_expense IN ('cost','expense','asset','liability','unknown')
           OR cost_or_expense IS NULL),
  ADD COLUMN IF NOT EXISTS memory_source             text
    CHECK (memory_source IN ('manual','history','rule/ciiu','rule/kind','default')
           OR memory_source IS NULL);

-- Índice para búsqueda por cuenta sugerida (útil para analytics de clasificación)
CREATE INDEX IF NOT EXISTS idx_ilc_suggested_account
  ON public.invoice_line_classifications(suggested_account_code)
  WHERE suggested_account_code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- invoice_tax_calculations: agregar campo de cuenta sugerida a nivel factura
-- Facilita la búsqueda y display sin parsear result_json.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoice_tax_calculations
  ADD COLUMN IF NOT EXISTS suggested_account_code    text,
  ADD COLUMN IF NOT EXISTS cost_or_expense           text
    CHECK (cost_or_expense IN ('cost','expense','asset','liability','unknown')
           OR cost_or_expense IS NULL),
  ADD COLUMN IF NOT EXISTS account_memory_source     text
    CHECK (account_memory_source IN ('manual','history','rule/ciiu','rule/kind','default')
           OR account_memory_source IS NULL);

-- Índice para clasificación/filtrado rápido por cuenta
CREATE INDEX IF NOT EXISTS idx_itc_suggested_account
  ON public.invoice_tax_calculations(suggested_account_code)
  WHERE suggested_account_code IS NOT NULL;

-- Comentario de tabla para documentar uso
COMMENT ON COLUMN public.invoice_tax_calculations.suggested_account_code IS
  'Cuenta contable sugerida por el motor (no hardcodeada). NULL = requiere revisión.';
COMMENT ON COLUMN public.invoice_tax_calculations.account_memory_source IS
  'Fuente de la sugerencia: manual > history > rule/ciiu > rule/kind > default';

-- =============================================================================
-- FIN de migración Task 19
-- =============================================================================
