-- Esquema propuesto en espanol para persistir extraccion DIAN (PDF/XML)
-- Ejecutar en Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.facturas_dian (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  tenant_id uuid,

  -- Documento
  doc_numero_factura text,
  doc_fecha_emision timestamptz,
  doc_fecha_vencimiento timestamptz,
  doc_tipo_operacion text,
  doc_forma_pago text,
  doc_medio_pago text,
  doc_orden_pedido text,
  doc_fecha_orden_pedido timestamptz,

  -- Emisor / vendedor
  emisor_razon_social text,
  emisor_nombre_comercial text,
  emisor_nit text,
  emisor_tipo_contribuyente text,
  emisor_regimen_fiscal text,
  emisor_responsabilidad_tributaria text,
  emisor_actividad_economica text,
  emisor_pais text,
  emisor_departamento text,
  emisor_ciudad text,
  emisor_direccion text,
  emisor_telefono text,
  emisor_correo text,

  -- Adquiriente / comprador
  adquiriente_nombre_razon_social text,
  adquiriente_tipo_documento text,
  adquiriente_numero_documento text,
  adquiriente_tipo_contribuyente text,
  adquiriente_regimen_fiscal text,
  adquiriente_responsabilidad_tributaria text,
  adquiriente_pais text,
  adquiriente_departamento text,
  adquiriente_ciudad text,
  adquiriente_direccion text,
  adquiriente_telefono text,
  adquiriente_correo text,

  -- Totales
  tot_moneda text,
  tot_subtotal numeric(18,2),
  tot_descuento_detalle numeric(18,2),
  tot_recargo_detalle numeric(18,2),
  tot_total_bruto_factura numeric(18,2),
  tot_iva numeric(18,2),
  tot_inc numeric(18,2),
  tot_bolsas numeric(18,2),
  tot_otros_impuestos numeric(18,2),
  tot_total_impuesto numeric(18,2),
  tot_total_neto_factura numeric(18,2),
  tot_descuento_global numeric(18,2),
  tot_recargo_global numeric(18,2),
  tot_total_factura numeric(18,2),
  tot_anticipos numeric(18,2),
  tot_rete_fuente numeric(18,2),
  tot_rete_iva numeric(18,2),
  tot_rete_ica numeric(18,2),

  -- Trazabilidad
  estado text default 'extraida',
  fuente_archivo text,
  json_crudo jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.facturas_dian_detalle (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturas_dian(id) on delete cascade,

  detalle_nro int,
  detalle_codigo text,
  detalle_descripcion text,
  detalle_um text,
  detalle_cantidad numeric(18,6),
  detalle_precio_unitario numeric(18,6),
  detalle_descuento numeric(18,2),
  detalle_recargo numeric(18,2),
  detalle_impuesto_iva numeric(18,2),
  detalle_porcentaje_iva numeric(10,4),
  detalle_impuesto_inc numeric(18,2),
  detalle_porcentaje_inc numeric(10,4),
  detalle_precio_unitario_venta numeric(18,6),

  creado_en timestamptz not null default now()
);

create index if not exists idx_facturas_dian_batch on public.facturas_dian(batch_id);
create index if not exists idx_facturas_dian_numero on public.facturas_dian(doc_numero_factura);
create index if not exists idx_facturas_dian_emisor_nit on public.facturas_dian(emisor_nit);
create index if not exists idx_facturas_dian_adquiriente_doc on public.facturas_dian(adquiriente_numero_documento);
create index if not exists idx_facturas_dian_detalle_factura on public.facturas_dian_detalle(factura_id);

-- Trigger de actualizado_en
create or replace function public.fn_set_actualizado_en()
returns trigger as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_facturas_dian_actualizado_en on public.facturas_dian;
create trigger trg_facturas_dian_actualizado_en
before update on public.facturas_dian
for each row execute function public.fn_set_actualizado_en();

-- Consultas de verificacion
-- select table_name from information_schema.tables where table_schema='public' and table_name like 'facturas_dian%';
-- select column_name from information_schema.columns where table_schema='public' and table_name='facturas_dian' order by ordinal_position;

-- =============================================================================
-- PARCHES IDEMPOTENTES — Columnas que pueden no existir en tablas creadas antes
-- de la versión actual del esquema.
-- Seguro de ejecutar múltiples veces (ADD COLUMN IF NOT EXISTS).
-- No modifica tipos de datos existentes ni elimina columnas.
-- =============================================================================

-- Columna fuente_archivo: indica si la factura provino de PDF, XML o ZIP
ALTER TABLE public.facturas_dian
  ADD COLUMN IF NOT EXISTS fuente_archivo text;

-- Columna tot_iva: total de IVA de la factura
-- Nota: si la columna ya existe con tipo diferente NO se modifica el tipo.
ALTER TABLE public.facturas_dian
  ADD COLUMN IF NOT EXISTS tot_iva numeric(18,2);

-- Nota sobre FK batch_id:
-- La FK referencia public.batches(id) que es el nombre real en Supabase producción.
-- El esquema Python local (schema.sql) usa invoice_batches — son dos esquemas distintos
-- y NO deben mezclarse. Este archivo aplica únicamente al esquema Supabase producción.

