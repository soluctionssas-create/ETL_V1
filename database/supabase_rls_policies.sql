-- =============================================================================
-- Supabase Row Level Security (RLS) Policies — ETL_V1
-- Generado: 2026-05-15
-- Revisión: Ver comentarios por tabla antes de ejecutar en producción.
-- Ejecutar en Supabase SQL Editor con permisos de administrador.
-- Este script es IDEMPOTENTE: se puede ejecutar múltiples veces de forma segura.
-- =============================================================================

-- =============================================================================
-- FUNCIÓN AUXILIAR — Obtener tenant_id del usuario autenticado
-- Consulta la tabla users para obtener el tenant_id del JWT uid actual.
-- Marcada SECURITY DEFINER para que pueda leer users sin exponer la tabla.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id
  FROM public.users
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- Revocar acceso público directo a la función (solo la usa RLS internamente)
REVOKE EXECUTE ON FUNCTION public.get_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_id() TO authenticated;


-- =============================================================================
-- TABLA: batches
-- Desde la migración supabase_batches_tenant_migration.sql, la tabla batches
-- tiene columna tenant_id (uuid, nullable, FK → public.tenants(id)).
--
-- PRE-REQUISITO: Ejecutar supabase_batches_tenant_migration.sql primero.
-- Si la columna tenant_id no existe, estas policies fallarán.
--
-- Nota sobre escritura: el código Next.js usa service_role_key (bypasses RLS)
-- para INSERT y UPDATE. Las policies de SELECT aplican a clientes que usen
-- la anon/authenticated key directamente (por ejemplo, consultas del dashboard).
-- =============================================================================
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;

-- SELECT: solo batches del propio tenant
DROP POLICY IF EXISTS "batches_select_authenticated" ON public.batches;
DROP POLICY IF EXISTS "batches_select_own_tenant" ON public.batches;
CREATE POLICY "batches_select_own_tenant"
  ON public.batches
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

-- INSERT: solo puede insertar batches para su propio tenant
DROP POLICY IF EXISTS "batches_insert_own_tenant" ON public.batches;
CREATE POLICY "batches_insert_own_tenant"
  ON public.batches
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

-- UPDATE: solo puede actualizar batches de su propio tenant
DROP POLICY IF EXISTS "batches_update_own_tenant" ON public.batches;
CREATE POLICY "batches_update_own_tenant"
  ON public.batches
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());

-- DELETE: bloqueado para authenticated (sin policy DELETE → acceso denegado)
-- service_role puede eliminar desde el backend si es necesario.


-- =============================================================================
-- TABLA: invoices
-- Tiene columna tenant_id (confirmado en código route.ts líneas 509-516).
-- Aislamiento completo por tenant.
-- =============================================================================
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- SELECT: solo registros del tenant del usuario autenticado
DROP POLICY IF EXISTS "invoices_select_own_tenant" ON public.invoices;
CREATE POLICY "invoices_select_own_tenant"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

-- INSERT: solo puede insertar para su propio tenant
DROP POLICY IF EXISTS "invoices_insert_own_tenant" ON public.invoices;
CREATE POLICY "invoices_insert_own_tenant"
  ON public.invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

-- UPDATE: solo puede actualizar registros de su propio tenant
DROP POLICY IF EXISTS "invoices_update_own_tenant" ON public.invoices;
CREATE POLICY "invoices_update_own_tenant"
  ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());

-- DELETE: no se permite borrado directo desde el cliente (soft-delete via backend)
-- Si necesitas habilitarlo, reemplaza la línea USING por:
--   USING (tenant_id = public.get_tenant_id())
DROP POLICY IF EXISTS "invoices_delete_blocked" ON public.invoices;
-- (DELETE bloqueado implícitamente al no existir policy DELETE para authenticated)


-- =============================================================================
-- TABLA: facturas_dian
-- Tiene columna tenant_id (definida en supabase_facturacion_dian_es.sql).
-- Aislamiento completo por tenant.
-- =============================================================================
ALTER TABLE public.facturas_dian ENABLE ROW LEVEL SECURITY;

-- SELECT
DROP POLICY IF EXISTS "facturas_dian_select_own_tenant" ON public.facturas_dian;
CREATE POLICY "facturas_dian_select_own_tenant"
  ON public.facturas_dian
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

-- INSERT
DROP POLICY IF EXISTS "facturas_dian_insert_own_tenant" ON public.facturas_dian;
CREATE POLICY "facturas_dian_insert_own_tenant"
  ON public.facturas_dian
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

-- UPDATE
DROP POLICY IF EXISTS "facturas_dian_update_own_tenant" ON public.facturas_dian;
CREATE POLICY "facturas_dian_update_own_tenant"
  ON public.facturas_dian
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());

-- DELETE: bloqueado para authenticated (usar service_role desde backend)


-- =============================================================================
-- TABLA: facturas_dian_detalle
-- NO tiene tenant_id. Aislamiento mediante JOIN con facturas_dian (tabla padre).
-- Un usuario solo puede ver detalles de facturas que pertenecen a su tenant.
-- =============================================================================
ALTER TABLE public.facturas_dian_detalle ENABLE ROW LEVEL SECURITY;

-- SELECT: via EXISTS sobre la tabla padre
DROP POLICY IF EXISTS "facturas_dian_detalle_select_own_tenant" ON public.facturas_dian_detalle;
CREATE POLICY "facturas_dian_detalle_select_own_tenant"
  ON public.facturas_dian_detalle
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.facturas_dian fd
      WHERE fd.id = facturas_dian_detalle.factura_id
        AND fd.tenant_id = public.get_tenant_id()
    )
  );

-- INSERT: solo si la factura padre pertenece al tenant del usuario
DROP POLICY IF EXISTS "facturas_dian_detalle_insert_own_tenant" ON public.facturas_dian_detalle;
CREATE POLICY "facturas_dian_detalle_insert_own_tenant"
  ON public.facturas_dian_detalle
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.facturas_dian fd
      WHERE fd.id = facturas_dian_detalle.factura_id
        AND fd.tenant_id = public.get_tenant_id()
    )
  );

-- UPDATE: mismo criterio
DROP POLICY IF EXISTS "facturas_dian_detalle_update_own_tenant" ON public.facturas_dian_detalle;
CREATE POLICY "facturas_dian_detalle_update_own_tenant"
  ON public.facturas_dian_detalle
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.facturas_dian fd
      WHERE fd.id = facturas_dian_detalle.factura_id
        AND fd.tenant_id = public.get_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.facturas_dian fd
      WHERE fd.id = facturas_dian_detalle.factura_id
        AND fd.tenant_id = public.get_tenant_id()
    )
  );

-- DELETE: bloqueado para authenticated


-- =============================================================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- Ejecutar estas queries después para confirmar que RLS está activo:
-- =============================================================================
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('batches', 'invoices', 'facturas_dian', 'facturas_dian_detalle');
--
-- SELECT schemaname, tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('batches', 'invoices', 'facturas_dian', 'facturas_dian_detalle')
-- ORDER BY tablename, policyname;
-- =============================================================================


-- =============================================================================
-- SECCIÓN: Motor Tributario — RLS para tablas del sprint Task 5-6
-- Generado: Task 7 Estabilización
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY
-- Nota: Los routes usan service_role_key (bypassa RLS). Estas policies
-- protegen el acceso directo con anon/authenticated key (dashboard, SDK).
-- =============================================================================


-- =============================================================================
-- TABLA: invoice_tax_calculations
-- Una fila por factura procesada por el motor tributario.
-- Aislamiento completo por tenant_id.
-- =============================================================================
ALTER TABLE public.invoice_tax_calculations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "itc_select_own_tenant" ON public.invoice_tax_calculations;
CREATE POLICY "itc_select_own_tenant"
  ON public.invoice_tax_calculations
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "itc_insert_own_tenant" ON public.invoice_tax_calculations;
CREATE POLICY "itc_insert_own_tenant"
  ON public.invoice_tax_calculations
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "itc_update_own_tenant" ON public.invoice_tax_calculations;
CREATE POLICY "itc_update_own_tenant"
  ON public.invoice_tax_calculations
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());

-- DELETE bloqueado para authenticated. service_role puede borrar desde backend.


-- =============================================================================
-- TABLA: invoice_line_classifications
-- Tabla futura (no poblada actualmente). RLS habilitada preventivamente.
-- Los datos de líneas viven en invoice_tax_calculations.result_json.
-- =============================================================================
ALTER TABLE public.invoice_line_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ilc_select_own_tenant" ON public.invoice_line_classifications;
CREATE POLICY "ilc_select_own_tenant"
  ON public.invoice_line_classifications
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "ilc_insert_own_tenant" ON public.invoice_line_classifications;
CREATE POLICY "ilc_insert_own_tenant"
  ON public.invoice_line_classifications
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "ilc_update_own_tenant" ON public.invoice_line_classifications;
CREATE POLICY "ilc_update_own_tenant"
  ON public.invoice_line_classifications
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());


-- =============================================================================
-- TABLA: invoice_tax_calculation_groups
-- Tabla futura (no poblada actualmente). RLS habilitada preventivamente.
-- Los grupos tributarios viven en invoice_tax_calculations.result_json.
-- =============================================================================
ALTER TABLE public.invoice_tax_calculation_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "itcg_select_own_tenant" ON public.invoice_tax_calculation_groups;
CREATE POLICY "itcg_select_own_tenant"
  ON public.invoice_tax_calculation_groups
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "itcg_insert_own_tenant" ON public.invoice_tax_calculation_groups;
CREATE POLICY "itcg_insert_own_tenant"
  ON public.invoice_tax_calculation_groups
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "itcg_update_own_tenant" ON public.invoice_tax_calculation_groups;
CREATE POLICY "itcg_update_own_tenant"
  ON public.invoice_tax_calculation_groups
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());


-- =============================================================================
-- TABLA: tenant_supplier_memory
-- Memoria histórica por proveedor y tenant.
-- =============================================================================
ALTER TABLE public.tenant_supplier_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tsm_select_own_tenant" ON public.tenant_supplier_memory;
CREATE POLICY "tsm_select_own_tenant"
  ON public.tenant_supplier_memory
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "tsm_insert_own_tenant" ON public.tenant_supplier_memory;
CREATE POLICY "tsm_insert_own_tenant"
  ON public.tenant_supplier_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "tsm_update_own_tenant" ON public.tenant_supplier_memory;
CREATE POLICY "tsm_update_own_tenant"
  ON public.tenant_supplier_memory
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());


-- =============================================================================
-- TABLA: tenant_tax_classification_memory
-- Aprendizaje por patrón de descripción de ítem + proveedor.
-- =============================================================================
ALTER TABLE public.tenant_tax_classification_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ttcm_select_own_tenant" ON public.tenant_tax_classification_memory;
CREATE POLICY "ttcm_select_own_tenant"
  ON public.tenant_tax_classification_memory
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "ttcm_insert_own_tenant" ON public.tenant_tax_classification_memory;
CREATE POLICY "ttcm_insert_own_tenant"
  ON public.tenant_tax_classification_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "ttcm_update_own_tenant" ON public.tenant_tax_classification_memory;
CREATE POLICY "ttcm_update_own_tenant"
  ON public.tenant_tax_classification_memory
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());


-- =============================================================================
-- TABLA: tenant_reclassification_audit
-- Auditoría de reclasificaciones manuales. Solo lectura para authenticated;
-- escritura exclusivamente por service_role (routes backend).
-- =============================================================================
ALTER TABLE public.tenant_reclassification_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tra_select_own_tenant" ON public.tenant_reclassification_audit;
CREATE POLICY "tra_select_own_tenant"
  ON public.tenant_reclassification_audit
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

-- INSERT y UPDATE solo desde service_role (backend). No definir policy para
-- authenticated → acceso denegado para INSERT/UPDATE/DELETE desde cliente.


-- =============================================================================
-- TABLA: tenant_accounting_patterns
-- Patrones contables aprendidos de movimientos históricos importados.
-- =============================================================================
ALTER TABLE public.tenant_accounting_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tap_select_own_tenant" ON public.tenant_accounting_patterns;
CREATE POLICY "tap_select_own_tenant"
  ON public.tenant_accounting_patterns
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "tap_insert_own_tenant" ON public.tenant_accounting_patterns;
CREATE POLICY "tap_insert_own_tenant"
  ON public.tenant_accounting_patterns
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "tap_update_own_tenant" ON public.tenant_accounting_patterns;
CREATE POLICY "tap_update_own_tenant"
  ON public.tenant_accounting_patterns
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());


-- =============================================================================
-- TABLA: accounting_movements_import
-- Movimientos contables históricos importados (CSV/XLSX).
-- =============================================================================
ALTER TABLE public.accounting_movements_import ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ami_select_own_tenant" ON public.accounting_movements_import;
CREATE POLICY "ami_select_own_tenant"
  ON public.accounting_movements_import
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "ami_insert_own_tenant" ON public.accounting_movements_import;
CREATE POLICY "ami_insert_own_tenant"
  ON public.accounting_movements_import
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS "ami_update_own_tenant" ON public.accounting_movements_import;
CREATE POLICY "ami_update_own_tenant"
  ON public.accounting_movements_import
  FOR UPDATE
  TO authenticated
  USING (tenant_id = public.get_tenant_id())
  WITH CHECK (tenant_id = public.get_tenant_id());


-- =============================================================================
-- VERIFICACIÓN POST-EJECUCIÓN — Motor Tributario
-- Ejecutar estas queries después para confirmar RLS + policies:
-- =============================================================================
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'invoice_tax_calculations',
--     'invoice_line_classifications',
--     'invoice_tax_calculation_groups',
--     'tenant_supplier_memory',
--     'tenant_tax_classification_memory',
--     'tenant_reclassification_audit',
--     'tenant_accounting_patterns',
--     'accounting_movements_import'
--   );
--
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'invoice_tax_calculations',
--     'invoice_line_classifications',
--     'invoice_tax_calculation_groups',
--     'tenant_supplier_memory',
--     'tenant_tax_classification_memory',
--     'tenant_reclassification_audit',
--     'tenant_accounting_patterns',
--     'accounting_movements_import'
--   )
-- ORDER BY tablename, policyname;
-- =============================================================================
