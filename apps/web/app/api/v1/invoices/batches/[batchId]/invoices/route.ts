import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    const record = asRecord(current);
    current = record[key];
    if (current === undefined) return undefined;
  }
  return current;
}

function firstDefined(obj: unknown, paths: string[][]): unknown {
  for (const p of paths) {
    const value = pickPath(obj, p);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function cleanDisplayText(value: unknown): string | null {
  const txt = asText(value);
  if (!txt) return null;
  const cleaned = txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asRecord(item));
}

function firstArray(obj: unknown, paths: string[][]): Record<string, unknown>[] {
  for (const p of paths) {
    const value = pickPath(obj, p);
    if (Array.isArray(value) && value.length > 0) {
      return asRecordArray(value);
    }
  }
  return [];
}

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await context.params;
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(request.nextUrl.searchParams.get("page_size") ?? "50");
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  // Validar que el batch pertenece al tenant del usuario autenticado.
  const { data: batchRecord } = await supabase
    .from("batches")
    .select("id, tenant_id")
    .eq("id", batchId)
    .single();

  if (!batchRecord) {
    return NextResponse.json({ detail: "Batch not found" }, { status: 404 });
  }

  const batchTenantId = (batchRecord as { tenant_id?: string | null }).tenant_id;
  if (batchTenantId) {
    const authHeader = request.headers.get("authorization");
    let resolvedTenantId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (!authError && user) {
        const { data: userRecord } = await supabase
          .from("users")
          .select("tenant_id")
          .eq("id", user.id)
          .single();
        resolvedTenantId = (userRecord as { tenant_id?: string } | null)?.tenant_id ?? null;
      }
    }

    if (!resolvedTenantId) {
      const { data: firstTenant } = await supabase
        .from("tenants")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      resolvedTenantId = (firstTenant as { id?: string } | null)?.id ?? null;
    }

    if (resolvedTenantId && batchTenantId !== resolvedTenantId) {
      return NextResponse.json({ detail: "Batch not found" }, { status: 404 });
    }
  }

  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize - 1;

  const { data, count, error } = await supabase
    .from("invoices")
    .select("id, batch_id, invoice_number, vendor_name, vendor_tax_id, total_amount, tax_amount, currency, status")
    .eq("batch_id", batchId)
    .range(from, to)
    .order("created_at", { ascending: false });

  if (error) {
    // If invoices table/schema does not match expected contract, return empty data.
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  const { data: dianInvoices } = await supabase
    .from("facturas_dian")
    .select("*")
    .eq("batch_id", batchId);

  const dianInvoiceIds = (dianInvoices ?? [])
    .map((row) => asText(asRecord(row).id))
    .filter((value): value is string => Boolean(value));

  let dianDetails: Record<string, unknown>[] = [];

  if (dianInvoiceIds.length > 0) {
    const { data: detailRows } = await supabase
      .from("facturas_dian_detalle")
      .select("*")
      .in("factura_id", dianInvoiceIds);

    dianDetails = (detailRows ?? []) as Record<string, unknown>[];
  }

  const dianByNumber = new Map(
    (dianInvoices ?? []).map((row) => {
      const record = asRecord(row);
      return [asText(record.doc_numero_factura) ?? "", record] as const;
    }),
  );

  const detailByFacturaId = new Map<string, Record<string, unknown>[]>();
  for (const row of dianDetails) {
    const record = asRecord(row);
    const facturaId = asText(record.factura_id) ?? "";
    if (!facturaId) continue;
    const group = detailByFacturaId.get(facturaId) ?? [];
    group.push(record);
    detailByFacturaId.set(facturaId, group);
  }

  const items = (data ?? []).map((row) => {
    const dianInvoice = asRecord(dianByNumber.get(row.invoice_number ?? ""));
    const dianDetailRows = detailByFacturaId.get(asText(dianInvoice.id) ?? "") ?? [];
    const dianDetail = asRecord(dianDetailRows[0]);
    const rawData = asRecord(dianInvoice.json_crudo);
    const issuer = asRecord(firstDefined(rawData, [["emisor"], ["issuer"], ["supplier"]]));
    const receiver = asRecord(firstDefined(rawData, [["receptor"], ["receiver"], ["customer"], ["buyer"]]));
    const rawItems = firstArray(rawData, [["items"], ["details"], ["line_items"]]);
    const taxes = asRecord(firstDefined(rawData, [["taxes"], ["impuestos"]]));
    const withholdings = asRecord(firstDefined(rawData, [["withholdings"], ["retentions"], ["retenciones"]]));
    const documentInfo = asRecord(firstDefined(rawData, [["datos_documento"], ["document"], ["documento"]]));
    const sellerInfo = asRecord(firstDefined(rawData, [["datos_emisor_vendedor"], ["seller"], ["emisor"]]));
    const buyerInfo = asRecord(firstDefined(rawData, [["datos_adquiriente_comprador"], ["buyer"], ["receptor"]]));
    const totals = asRecord(firstDefined(rawData, [["totales"], ["totals"]]));

    const normalizedItemsFromRaw = rawItems.map((item, index) => ({
      line_number: cleanDisplayText(firstDefined(item, [["nro"], ["line_number"], ["item_number"]])) ?? String(index + 1),
      item_code: cleanDisplayText(firstDefined(item, [["codigo"], ["item_code"], ["code"]])),
      item_description: cleanDisplayText(firstDefined(item, [["descripcion"], ["description"], ["item_description"]])),
      unit: cleanDisplayText(firstDefined(item, [["um"], ["uom"], ["unidad_medida"]])),
      quantity: asNumber(firstDefined(item, [["cantidad"], ["quantity"]])),
      unit_price: asNumber(firstDefined(item, [["precio_unitario"], ["unit_price"]])),
      discount: asNumber(firstDefined(item, [["descuento_detalle"], ["discount"]])),
      surcharge: asNumber(firstDefined(item, [["recargo_detalle"], ["surcharge"]])),
      tax_iva: asNumber(firstDefined(item, [["impuesto_iva"], ["iva"]])),
      tax_iva_rate: asNumber(firstDefined(item, [["iva_perc"], ["iva_rate"]])),
      tax_inc: asNumber(firstDefined(item, [["impuesto_inc"], ["inc"]])),
      tax_inc_rate: asNumber(firstDefined(item, [["inc_perc"], ["inc_rate"]])),
      sale_unit_price: asNumber(firstDefined(item, [["precio_unitario_venta"], ["sale_unit_price"]])),
    }));

    const normalizedItemsFromDian = dianDetailRows.map((detail, index) => ({
      line_number: cleanDisplayText(detail.detalle_nro) ?? String(index + 1),
      item_code: cleanDisplayText(detail.detalle_codigo),
      item_description: cleanDisplayText(detail.detalle_descripcion),
      unit: cleanDisplayText(detail.detalle_um),
      quantity: asNumber(detail.detalle_cantidad),
      unit_price: asNumber(detail.detalle_precio_unitario),
      discount: asNumber(detail.detalle_descuento),
      surcharge: asNumber(detail.detalle_recargo),
      tax_iva: asNumber(detail.detalle_impuesto_iva),
      tax_iva_rate: asNumber(detail.detalle_porcentaje_iva),
      tax_inc: asNumber(detail.detalle_impuesto_inc),
      tax_inc_rate: asNumber(detail.detalle_porcentaje_inc),
      sale_unit_price: asNumber(detail.detalle_precio_unitario_venta),
    }));

    const normalizedItems = normalizedItemsFromRaw.length > 0 ? normalizedItemsFromRaw : normalizedItemsFromDian;
    const firstItem = asRecord(rawItems[0] ?? normalizedItems[0]);

    return {
      ...row,
      document_type: firstDefined(rawData, [["document_type"], ["tipo_documento"]]) ?? dianInvoice.doc_tipo_operacion ?? null,
      cufe_cude: firstDefined(rawData, [["cufe_cude"], ["cufe"], ["cude"]]),
      folio: firstDefined(rawData, [["folio"], ["invoice_number"]]),
      prefix: firstDefined(rawData, [["prefix"], ["prefijo"]]),
      payment_form: firstDefined(rawData, [["payment_form"], ["forma_pago"]]) ?? dianInvoice.doc_forma_pago ?? null,
      payment_method: firstDefined(rawData, [["payment_method"], ["medio_pago"]]) ?? dianInvoice.doc_medio_pago ?? null,
      issue_date: firstDefined(rawData, [["issue_date"], ["fecha_emision"]]) ?? dianInvoice.doc_fecha_emision ?? null,
      reception_date: firstDefined(rawData, [["reception_date"], ["fecha_recepcion"]]),
      receiver_tax_id: firstDefined(receiver, [["tax_id"], ["nit"], ["document"]]) ?? dianInvoice.adquiriente_numero_documento ?? null,
      receiver_name: firstDefined(receiver, [["name"], ["nombre"]]) ?? dianInvoice.adquiriente_nombre_razon_social ?? null,
      vendor_tax_id: row.vendor_tax_id ?? firstDefined(issuer, [["tax_id"], ["nit"], ["document"]]) ?? dianInvoice.emisor_nit ?? null,
      vendor_name: row.vendor_name ?? firstDefined(issuer, [["name"], ["nombre"]]) ?? dianInvoice.emisor_razon_social ?? null,
      item_code: cleanDisplayText(firstDefined(firstItem, [["item_code"], ["codigo"], ["code"]])) ?? cleanDisplayText(dianDetail.detalle_codigo) ?? null,
      item_description: cleanDisplayText(firstDefined(firstItem, [["item_description"], ["description"], ["descripcion"]])) ?? cleanDisplayText(dianDetail.detalle_descripcion) ?? null,
      quantity: asNumber(firstDefined(firstItem, [["quantity"], ["cantidad"]])) ?? asNumber(dianDetail.detalle_cantidad),
      unit_price: asNumber(firstDefined(firstItem, [["unit_price"], ["precio_unitario"]])) ?? asNumber(dianDetail.detalle_precio_unitario),
      iva: asNumber(firstDefined(taxes, [["iva"], ["IVA"]])),
      ica: asNumber(firstDefined(taxes, [["ica"], ["ICA"]])),
      ic: asNumber(firstDefined(taxes, [["ic"], ["IC"]])),
      inc: asNumber(firstDefined(taxes, [["inc"], ["INC"]])),
      timbre: asNumber(firstDefined(taxes, [["timbre"], ["TIMBRE"]])),
      inc_bolsas: asNumber(firstDefined(taxes, [["inc_bolsas"], ["INC_BOLSAS"]])),
      in_carbono: asNumber(firstDefined(taxes, [["in_carbono"], ["IN_CARBONO"]])),
      in_combustibles: asNumber(firstDefined(taxes, [["in_combustibles"], ["IN_COMBUSTIBLES"]])),
      ic_datos: asNumber(firstDefined(taxes, [["ic_datos"], ["IC_DATOS"]])),
      icl: asNumber(firstDefined(taxes, [["icl"], ["ICL"]])),
      inpp: asNumber(firstDefined(taxes, [["inpp"], ["INPP"]])),
      ibua: asNumber(firstDefined(taxes, [["ibua"], ["IBUA"]])),
      icui: asNumber(firstDefined(taxes, [["icui"], ["ICUI"]])),
      rete_iva: asNumber(firstDefined(withholdings, [["rete_iva"], ["reteiva"], ["iva"]])),
      rete_renta: asNumber(firstDefined(withholdings, [["rete_renta"], ["reterenta"], ["renta"]])),
      rete_ica: asNumber(firstDefined(withholdings, [["rete_ica"], ["reteica"], ["ica"]])),
      group_name: firstDefined(rawData, [["group"], ["grupo"]]),

      // Alias en espanol para facilitar uso funcional/contable.
      doc_numero_factura: asText(firstDefined(documentInfo, [["numero_factura"], ["invoice_number"]])) ?? asText(dianInvoice.doc_numero_factura) ?? row.invoice_number,
      doc_fecha_emision: asText(firstDefined(documentInfo, [["fecha_emision"], ["issue_date"]])) ?? asText(firstDefined(rawData, [["issue_date"], ["fecha_emision"]])) ?? asText(dianInvoice.doc_fecha_emision),
      doc_fecha_vencimiento: asText(firstDefined(documentInfo, [["fecha_vencimiento"], ["due_date"]])) ?? asText(dianInvoice.doc_fecha_vencimiento),
      doc_tipo_operacion: asText(firstDefined(documentInfo, [["tipo_operacion"], ["operation_type"]])) ?? asText(dianInvoice.doc_tipo_operacion),
      doc_forma_pago: asText(firstDefined(documentInfo, [["forma_pago"], ["payment_form"]])) ?? asText(firstDefined(rawData, [["payment_form"], ["forma_pago"]])) ?? asText(dianInvoice.doc_forma_pago),
      doc_medio_pago: asText(firstDefined(documentInfo, [["medio_pago"], ["payment_method"]])) ?? asText(firstDefined(rawData, [["payment_method"], ["medio_pago"]])) ?? asText(dianInvoice.doc_medio_pago),
      doc_orden_pedido: asText(firstDefined(documentInfo, [["orden_pedido"], ["purchase_order"]])) ?? asText(dianInvoice.doc_orden_pedido),
      doc_fecha_orden_pedido: asText(firstDefined(documentInfo, [["fecha_orden_pedido"], ["purchase_order_date"]])) ?? asText(dianInvoice.doc_fecha_orden_pedido),

      emisor_razon_social: asText(firstDefined(sellerInfo, [["razon_social"], ["legal_name"], ["name"]])) ?? asText(dianInvoice.emisor_razon_social) ?? asText(row.vendor_name),
      emisor_nombre_comercial: asText(firstDefined(sellerInfo, [["nombre_comercial"], ["trade_name"]])) ?? asText(dianInvoice.emisor_nombre_comercial),
      emisor_nit: asText(firstDefined(sellerInfo, [["nit"], ["tax_id"], ["document"]])) ?? asText(dianInvoice.emisor_nit) ?? asText(row.vendor_tax_id),
      emisor_tipo_contribuyente: asText(firstDefined(sellerInfo, [["tipo_contribuyente"], ["taxpayer_type"]])) ?? asText(dianInvoice.emisor_tipo_contribuyente),
      emisor_regimen_fiscal: asText(firstDefined(sellerInfo, [["regimen_fiscal"], ["tax_regime"]])) ?? asText(dianInvoice.emisor_regimen_fiscal),
      emisor_responsabilidad_tributaria: asText(firstDefined(sellerInfo, [["responsabilidad_tributaria"], ["tax_responsibility"]])) ?? asText(dianInvoice.emisor_responsabilidad_tributaria),
      emisor_actividad_economica: asText(firstDefined(sellerInfo, [["actividad_economica"], ["economic_activity"]])) ?? asText(dianInvoice.emisor_actividad_economica),
      emisor_pais: asText(firstDefined(sellerInfo, [["pais"], ["country"]])) ?? asText(dianInvoice.emisor_pais),
      emisor_departamento: asText(firstDefined(sellerInfo, [["departamento"], ["state"]])) ?? asText(dianInvoice.emisor_departamento),
      emisor_ciudad: asText(firstDefined(sellerInfo, [["municipio_ciudad"], ["city"]])) ?? asText(dianInvoice.emisor_ciudad),
      emisor_direccion: asText(firstDefined(sellerInfo, [["direccion"], ["address"]])) ?? asText(dianInvoice.emisor_direccion),
      emisor_telefono: asText(firstDefined(sellerInfo, [["telefono_movil"], ["phone"]])) ?? asText(dianInvoice.emisor_telefono),
      emisor_correo: asText(firstDefined(sellerInfo, [["correo"], ["email"]])) ?? asText(dianInvoice.emisor_correo),

      adquiriente_nombre_razon_social: asText(firstDefined(buyerInfo, [["nombre_razon_social"], ["name"], ["legal_name"]])) ?? asText(firstDefined(receiver, [["name"], ["nombre"]])) ?? asText(dianInvoice.adquiriente_nombre_razon_social),
      adquiriente_tipo_documento: asText(firstDefined(buyerInfo, [["tipo_documento"], ["document_type"]])) ?? asText(dianInvoice.adquiriente_tipo_documento),
      adquiriente_numero_documento: asText(firstDefined(buyerInfo, [["numero_documento"], ["document_number"], ["nit"], ["tax_id"]])) ?? asText(firstDefined(receiver, [["tax_id"], ["nit"], ["document"]])) ?? asText(dianInvoice.adquiriente_numero_documento),
      adquiriente_tipo_contribuyente: asText(firstDefined(buyerInfo, [["tipo_contribuyente"], ["taxpayer_type"]])) ?? asText(dianInvoice.adquiriente_tipo_contribuyente),
      adquiriente_regimen_fiscal: asText(firstDefined(buyerInfo, [["regimen_fiscal"], ["tax_regime"]])) ?? asText(dianInvoice.adquiriente_regimen_fiscal),
      adquiriente_responsabilidad_tributaria: asText(firstDefined(buyerInfo, [["responsabilidad_tributaria"], ["tax_responsibility"]])) ?? asText(dianInvoice.adquiriente_responsabilidad_tributaria),
      adquiriente_pais: asText(firstDefined(buyerInfo, [["pais"], ["country"]])) ?? asText(dianInvoice.adquiriente_pais),
      adquiriente_departamento: asText(firstDefined(buyerInfo, [["departamento"], ["state"]])) ?? asText(dianInvoice.adquiriente_departamento),
      adquiriente_ciudad: asText(firstDefined(buyerInfo, [["municipio_ciudad"], ["city"]])) ?? asText(dianInvoice.adquiriente_ciudad),
      adquiriente_direccion: asText(firstDefined(buyerInfo, [["direccion"], ["address"]])) ?? asText(dianInvoice.adquiriente_direccion),
      adquiriente_telefono: asText(firstDefined(buyerInfo, [["telefono_movil"], ["phone"]])) ?? asText(dianInvoice.adquiriente_telefono),
      adquiriente_correo: asText(firstDefined(buyerInfo, [["correo"], ["email"]])) ?? asText(dianInvoice.adquiriente_correo),

      detalle_nro: cleanDisplayText(firstDefined(firstItem, [["nro"], ["line_number"], ["item_number"]])) ?? cleanDisplayText(dianDetail.detalle_nro),
      detalle_codigo: cleanDisplayText(firstDefined(firstItem, [["codigo"], ["item_code"], ["code"]])) ?? cleanDisplayText(firstDefined(firstItem, [["item_code"], ["codigo"], ["code"]])) ?? cleanDisplayText(dianDetail.detalle_codigo),
      detalle_descripcion: cleanDisplayText(firstDefined(firstItem, [["descripcion"], ["description"], ["item_description"]])) ?? cleanDisplayText(firstDefined(firstItem, [["item_description"], ["description"], ["descripcion"]])) ?? cleanDisplayText(dianDetail.detalle_descripcion),
      detalle_um: cleanDisplayText(firstDefined(firstItem, [["um"], ["uom"], ["unidad_medida"]])) ?? cleanDisplayText(dianDetail.detalle_um),
      detalle_cantidad: asNumber(firstDefined(firstItem, [["cantidad"], ["quantity"]])) ?? asNumber(firstDefined(firstItem, [["quantity"], ["cantidad"]])) ?? asNumber(dianDetail.detalle_cantidad),
      detalle_precio_unitario: asNumber(firstDefined(firstItem, [["precio_unitario"], ["unit_price"]])) ?? asNumber(firstDefined(firstItem, [["unit_price"], ["precio_unitario"]])) ?? asNumber(dianDetail.detalle_precio_unitario),
      detalle_descuento: asNumber(firstDefined(firstItem, [["descuento_detalle"], ["discount"]])) ?? asNumber(dianDetail.detalle_descuento),
      detalle_recargo: asNumber(firstDefined(firstItem, [["recargo_detalle"], ["surcharge"]])) ?? asNumber(dianDetail.detalle_recargo),
      detalle_impuesto_iva: asNumber(firstDefined(firstItem, [["impuesto_iva"], ["iva"]])) ?? asNumber(dianDetail.detalle_impuesto_iva),
      detalle_porcentaje_iva: asNumber(firstDefined(firstItem, [["iva_perc"], ["iva_rate"]])) ?? asNumber(dianDetail.detalle_porcentaje_iva),
      detalle_impuesto_inc: asNumber(firstDefined(firstItem, [["impuesto_inc"], ["inc"]])) ?? asNumber(dianDetail.detalle_impuesto_inc),
      detalle_porcentaje_inc: asNumber(firstDefined(firstItem, [["inc_perc"], ["inc_rate"]])) ?? asNumber(dianDetail.detalle_porcentaje_inc),
      detalle_precio_unitario_venta: asNumber(firstDefined(firstItem, [["precio_unitario_venta"], ["sale_unit_price"]])) ?? asNumber(dianDetail.detalle_precio_unitario_venta),

      items: normalizedItems,

      tot_moneda: asText(firstDefined(totals, [["moneda"], ["currency"]])) ?? asText(dianInvoice.tot_moneda) ?? row.currency,
      tot_subtotal: asNumber(firstDefined(totals, [["subtotal"]])) ?? asNumber(dianInvoice.tot_subtotal),
      tot_descuento_detalle: asNumber(firstDefined(totals, [["descuento_detalle"], ["item_discount"]])),
      tot_recargo_detalle: asNumber(firstDefined(totals, [["recargao_detalle"], ["recargo_detalle"], ["item_surcharge"]])),
      tot_total_bruto_factura: asNumber(firstDefined(totals, [["total_bruto_factura"], ["gross_total"]])) ?? asNumber(dianInvoice.tot_total_bruto_factura),
      tot_iva: asNumber(firstDefined(totals, [["iva"], ["IVA"]])) ?? asNumber(firstDefined(taxes, [["iva"], ["IVA"]])) ?? asNumber(dianInvoice.tot_iva),
      tot_inc: asNumber(firstDefined(totals, [["inc"], ["INC"]])) ?? asNumber(firstDefined(taxes, [["inc"], ["INC"]])) ?? asNumber(dianInvoice.tot_inc),
      tot_bolsas: asNumber(firstDefined(totals, [["bolsas"]])) ?? asNumber(dianInvoice.tot_bolsas),
      tot_otros_impuestos: asNumber(firstDefined(totals, [["otros_impuestos"], ["other_taxes"]])) ?? asNumber(dianInvoice.tot_otros_impuestos),
      tot_total_impuesto: asNumber(firstDefined(totals, [["total_impuesto"], ["tax_total"]])) ?? asNumber(dianInvoice.tot_total_impuesto),
      tot_total_neto_factura: asNumber(firstDefined(totals, [["total_neto_factura"], ["net_total"]])) ?? asNumber(dianInvoice.tot_total_neto_factura),
      tot_descuento_global: asNumber(firstDefined(totals, [["descuento_global"], ["global_discount"]])),
      tot_recargo_global: asNumber(firstDefined(totals, [["recargo_global"], ["global_surcharge"]])),
      tot_total_factura: asNumber(firstDefined(totals, [["total_factura"], ["invoice_total"]])) ?? asNumber(dianInvoice.tot_total_factura) ?? row.total_amount,
      tot_anticipos: asNumber(firstDefined(totals, [["anticipos"], ["advances"]])) ?? asNumber(dianInvoice.tot_anticipos),
      tot_rete_fuente: asNumber(firstDefined(totals, [["rete_fuente"], ["ret_fuente"]])) ?? asNumber(dianInvoice.tot_rete_fuente),
      tot_rete_iva: asNumber(firstDefined(totals, [["rete_iva"], ["ret_iva"]])) ?? asNumber(firstDefined(withholdings, [["rete_iva"], ["reteiva"], ["iva"]])) ?? asNumber(dianInvoice.tot_rete_iva),
      tot_rete_ica: asNumber(firstDefined(totals, [["rete_ica"], ["ret_ica"]])) ?? asNumber(firstDefined(withholdings, [["rete_ica"], ["reteica"], ["ica"]])) ?? asNumber(dianInvoice.tot_rete_ica),

      raw_data: rawData,
    };
  });

  return NextResponse.json({
    total: count ?? (data?.length ?? 0),
    page,
    page_size: pageSize,
    items,
  });
}
