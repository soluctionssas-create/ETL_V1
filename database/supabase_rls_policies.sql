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
