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

  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize - 1;

  const { data, count, error } = await supabase
    .from("invoices")
    .select("id, batch_id, invoice_number, vendor_name, vendor_tax_id, total_amount, tax_amount, currency, status, raw_data")
    .eq("batch_id", batchId)
    .range(from, to)
    .order("created_at", { ascending: false });

  if (error) {
    // If invoices table/schema does not match expected contract, return empty data.
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  const items = (data ?? []).map((row) => {
    const rawData = asRecord(row.raw_data);
    const issuer = asRecord(firstDefined(rawData, [["emisor"], ["issuer"], ["supplier"]]));
    const receiver = asRecord(firstDefined(rawData, [["receptor"], ["receiver"], ["customer"], ["buyer"]]));
    const firstItem = asRecord(firstDefined(rawData, [["items", "0"], ["details", "0"], ["line_items", "0"]]));
    const taxes = asRecord(firstDefined(rawData, [["taxes"], ["impuestos"]]));
    const withholdings = asRecord(firstDefined(rawData, [["withholdings"], ["retentions"], ["retenciones"]]));

    return {
      ...row,
      document_type: firstDefined(rawData, [["document_type"], ["tipo_documento"]]),
      cufe_cude: firstDefined(rawData, [["cufe_cude"], ["cufe"], ["cude"]]),
      folio: firstDefined(rawData, [["folio"], ["invoice_number"]]),
      prefix: firstDefined(rawData, [["prefix"], ["prefijo"]]),
      payment_form: firstDefined(rawData, [["payment_form"], ["forma_pago"]]),
      payment_method: firstDefined(rawData, [["payment_method"], ["medio_pago"]]),
      issue_date: firstDefined(rawData, [["issue_date"], ["fecha_emision"]]),
      reception_date: firstDefined(rawData, [["reception_date"], ["fecha_recepcion"]]),
      receiver_tax_id: firstDefined(receiver, [["tax_id"], ["nit"], ["document"]]),
      receiver_name: firstDefined(receiver, [["name"], ["nombre"]]),
      vendor_tax_id: row.vendor_tax_id ?? firstDefined(issuer, [["tax_id"], ["nit"], ["document"]]),
      vendor_name: row.vendor_name ?? firstDefined(issuer, [["name"], ["nombre"]]),
      item_code: firstDefined(firstItem, [["item_code"], ["codigo"], ["code"]]),
      item_description: firstDefined(firstItem, [["item_description"], ["description"], ["descripcion"]]),
      quantity: asNumber(firstDefined(firstItem, [["quantity"], ["cantidad"]])),
      unit_price: asNumber(firstDefined(firstItem, [["unit_price"], ["precio_unitario"]])),
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
      raw_data: row.raw_data,
    };
  });

  return NextResponse.json({
    total: count ?? (data?.length ?? 0),
    page,
    page_size: pageSize,
    items,
  });
}
