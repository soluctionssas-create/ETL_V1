import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import { createRequire } from "node:module";
import {
  extractDianInvoiceFromXml,
  extractDianInvoiceFromPdfText,
  canonicalToFacturaDian,
  canonicalLinesToDetalles,
} from "@/lib/dian";
import type { DianCanonicalInvoice } from "@/lib/dian/dian-canonical-types";
import { calculateInvoiceTaxes } from "@/lib/tax/calculate-invoice-taxes";
import { getDefaultTaxRulesConfig } from "@/lib/tax/tax-rules-loader";
import { loadClassifyContext } from "@/lib/tax/load-classify-context";

export const runtime = "nodejs";

type BatchRow = {
  id: string;
  filename: string;
  file_size: number;
  file_type: string;
  status: string;
  total_invoices: number;
  processed_invoices: number;
  failed_invoices: number;
  celery_task_id: string | null;
  error_message: string | null;
  tenant_id?: string | null;
};

type InvoiceSeed = {
  invoiceId: string;
  invoice_number: string;
  vendor_name: string;
  vendor_tax_id: string | null;
  customer_name: string;
  customer_tax_id: string | null;
  total_amount: number | null;
  tax_amount: number | null;
  currency: string;
  raw_data: Record<string, unknown>;
  dian_invoice: Record<string, unknown>;
  dian_details: Record<string, unknown>[];
  canonical?: DianCanonicalInvoice;
};

function extractXmlTag(source: string, tags: string[]): string | null {
  for (const tag of tags) {
    const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i");
    const match = source.match(regex);
    if (match?.[1]) {
      const cleaned = match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      if (cleaned) return cleaned;
    }
  }

  return null;
}

function extractXmlSection(source: string, tags: string[]): string {
  for (const tag of tags) {
    const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${tag}>`, "i");
    const match = source.match(regex);
    if (match?.[0]) return match[0];
  }

  return "";
}

function extractXmlSections(source: string, tags: string[]): string[] {
  for (const tag of tags) {
    const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${tag}>`, "gi");
    const matches = Array.from(source.matchAll(regex)).map((match) => match[0]);
    if (matches.length > 0) return matches;
  }

  return [];
}

function asNullableNumber(value: string | null): number | null {
  if (!value) return null;

  const normalized = value.replace(/[^0-9,.-]/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function fileBaseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function sanitizeText(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function parseDateToIso(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearRaw = Number(match[3]);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const d = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return d;
}

function extractPdfItems(lines: string[], sourceName: string): Array<Record<string, unknown>> {
  const excludedWords = /(total|subtotal|iva|rete|reten|impuesto|descuento|saldo|vencim|resumen)/i;
  const moneyPattern = /\b\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})\b|\b\d+(?:,\d{2})\b/g;
  const items: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    if (excludedWords.test(line)) continue;

    const amounts = Array.from(line.matchAll(moneyPattern)).map((match) => match[0]);
    if (amounts.length === 0) continue;

    const codeCandidate = sanitizeText((line.match(/^\s*([A-Z0-9-]{4,})\b/i)?.[1] ?? null));
    const qtyCandidate = line.match(/\b(\d{1,4}(?:[.,]\d{1,3})?)\b/);
    const quantity = qtyCandidate ? asNullableNumber(qtyCandidate[1]) : 1;
    const unitPrice = asNullableNumber(amounts.length > 1 ? amounts[amounts.length - 2] : amounts[0]);
    const salePrice = asNullableNumber(amounts[amounts.length - 1]);

    let description = line;
    for (const amount of amounts) {
      description = description.replace(amount, " ");
    }
    if (codeCandidate) {
      description = description.replace(new RegExp(`^\\s*${codeCandidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ");
    }
    const cleanDescription = sanitizeText(description) ?? `Item ${items.length + 1}`;

    if (cleanDescription.length < 3) continue;

    items.push({
      nro: items.length + 1,
      codigo: codeCandidate ?? `${fileBaseName(sourceName)}-${items.length + 1}`,
      descripcion: cleanDescription,
      cantidad: quantity ?? 1,
      precio_unitario: unitPrice,
      impuesto_iva: null,
      precio_unitario_venta: salePrice,
    });
  }

  return items;
}

async function buildInvoiceSeedFromPdf(file: File, batchId: string, invoiceId: string): Promise<InvoiceSeed> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const require = createRequire(import.meta.url);
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (data: Buffer) => Promise<{ text?: string }>;

  // ── Nuevo extractor canónico PDF ──────────────────────────────────────────
  const parsed = await pdfParse(buffer);
  const text = parsed.text ?? "";
  const canonical = extractDianInvoiceFromPdfText(text, { fileName: file.name });
  const dianInvoice = canonicalToFacturaDian(canonical, batchId);
  const dianDetails = canonicalLinesToDetalles(canonical);
  const invoiceNumber = String(
    canonical.datos_documento_numero_factura.value ??
    `${fileBaseName(file.name).slice(0, 40) || "PDF"}-${batchId.slice(0, 8)}`
  );
  return {
    invoiceId,
    invoice_number: invoiceNumber,
    vendor_name: String(canonical.datos_emisor_vendedor_razon_social.value ?? "Pendiente de extraccion PDF"),
    vendor_tax_id: canonical.datos_emisor_vendedor_nit_emisor.value ?? null,
    customer_name: String(canonical.datos_adquiriente_comprador_nombre_razon_social.value ?? "Pendiente de extraccion PDF"),
    customer_tax_id: canonical.datos_adquiriente_comprador_numero_documento.value ?? null,
    total_amount: canonical.totales_total_factura.value ?? null,
    tax_amount: canonical.totales_total_impuesto.value ?? null,
    currency: String(canonical.totales_moneda.value ?? "COP"),
    raw_data: {
      origen_extraccion: "pdf_canonical",
      texto_plano: text.slice(0, 5000),
      extraction_warnings: canonical.extraction_warnings,
    },
    dian_invoice: dianInvoice,
    dian_details: dianDetails,
    canonical,
  };
}

function buildInvoiceSeedFromXml(sourceName: string, xml: string, batchId: string, invoiceId: string): InvoiceSeed {
  // ── Nuevo extractor canónico XML ──────────────────────────────────────────
  const canonical = extractDianInvoiceFromXml(xml, { fileName: sourceName });
  const dianInvoice = canonicalToFacturaDian(canonical, batchId);
  const dianDetails = canonicalLinesToDetalles(canonical);
  const invoiceNumber = String(
    canonical.datos_documento_numero_factura.value ??
    `${fileBaseName(sourceName)}-${batchId.slice(0, 8)}`
  );
  return {
    invoiceId,
    invoice_number: invoiceNumber,
    vendor_name: String(canonical.datos_emisor_vendedor_razon_social.value ?? "Proveedor XML"),
    vendor_tax_id: canonical.datos_emisor_vendedor_nit_emisor.value ?? null,
    customer_name: String(canonical.datos_adquiriente_comprador_nombre_razon_social.value ?? "Cliente XML"),
    customer_tax_id: canonical.datos_adquiriente_comprador_numero_documento.value ?? null,
    total_amount: canonical.totales_total_factura.value ?? null,
    tax_amount: canonical.totales_total_impuesto.value ?? null,
    currency: String(canonical.totales_moneda.value ?? "COP"),
    raw_data: { origen_extraccion: "xml_canonical" },
    dian_invoice: dianInvoice,
    dian_details: dianDetails,
    canonical,
  };
}
// ─── Legacy XML helper functions (kept for reference) ────────────────────────
function _buildInvoiceSeedFromXml_legacy(sourceName: string, xml: string, batchId: string, invoiceId: string): InvoiceSeed {
  const supplierSection = extractXmlSection(xml, ["AccountingSupplierParty", "SupplierParty"]);
  const customerSection = extractXmlSection(xml, ["AccountingCustomerParty", "CustomerParty"]);
  const totalSection = extractXmlSection(xml, ["LegalMonetaryTotal", "RequestedMonetaryTotal"]);
  const taxSection = extractXmlSection(xml, ["TaxTotal"]);
  const lineSections = extractXmlSections(xml, ["InvoiceLine", "CreditNoteLine", "DebitNoteLine"]);

  const invoiceNumber = sanitizeText(extractXmlTag(xml, ["ID"])) ?? `${fileBaseName(sourceName)}-${batchId.slice(0, 8)}`;
  const issueDate = sanitizeText(extractXmlTag(xml, ["IssueDate"])) ?? new Date().toISOString();
  const dueDate = sanitizeText(extractXmlTag(xml, ["DueDate", "PaymentDueDate"]));
  const currency = sanitizeText(extractXmlTag(xml, ["DocumentCurrencyCode"])) ?? "COP";
  const vendorName = sanitizeText(extractXmlTag(supplierSection, ["RegistrationName", "Name"])) ?? "Proveedor XML";
  const vendorTaxId = sanitizeText(extractXmlTag(supplierSection, ["CompanyID", "ID"]));
  const customerName = sanitizeText(extractXmlTag(customerSection, ["RegistrationName", "Name"])) ?? "Cliente XML";
  const customerTaxId = sanitizeText(extractXmlTag(customerSection, ["CompanyID", "ID"]));
  const subtotal = asNullableNumber(extractXmlTag(totalSection, ["LineExtensionAmount"]));
  const totalAmount =
    asNullableNumber(extractXmlTag(totalSection, ["PayableAmount", "TaxInclusiveAmount"])) ?? subtotal;
  const taxAmount = asNullableNumber(extractXmlTag(taxSection, ["TaxAmount"]));
  const parsedLineItems = lineSections.map((lineSection, index) => {
    const itemSection = extractXmlSection(lineSection, ["Item"]);
    const priceSection = extractXmlSection(lineSection, ["Price"]);
    const quantity = asNullableNumber(extractXmlTag(lineSection, ["InvoicedQuantity", "CreditedQuantity", "DebitedQuantity"])) ?? 1;
    const description = sanitizeText(extractXmlTag(itemSection || lineSection, ["Description", "Name"])) ?? `Item ${index + 1}`;
    const itemCode = sanitizeText(extractXmlTag(itemSection || lineSection, ["SellersItemIdentification", "StandardItemIdentification", "ID"])) ?? `${sourceName}-${index + 1}`;
    const unitPrice = asNullableNumber(extractXmlTag(priceSection || lineSection, ["PriceAmount"]));
    const lineTax = asNullableNumber(extractXmlTag(lineSection, ["TaxAmount"]));
    const lineTotal =
      asNullableNumber(extractXmlTag(lineSection, ["LineExtensionAmount", "TaxInclusiveLineExtensionAmount"])) ??
      (unitPrice != null ? unitPrice * quantity : null);

    return {
      nro: index + 1,
      codigo: itemCode,
      descripcion: description,
      cantidad: quantity,
      precio_unitario: unitPrice,
      impuesto_iva: lineTax,
      precio_unitario_venta: lineTotal,
    };
  });

  const finalLineItems = parsedLineItems.length > 0
    ? parsedLineItems
    : [
        {
          nro: 1,
          codigo: sourceName,
          descripcion: `XML ${sourceName}`,
          cantidad: 1,
          precio_unitario: subtotal,
          impuesto_iva: taxAmount,
          precio_unitario_venta: totalAmount,
        },
      ];

  const rawData = {
    origen_extraccion: "xml_basico",
    datos_documento: {
      numero_factura: invoiceNumber,
      fecha_emision: issueDate,
      fecha_vencimiento: dueDate,
      forma_pago: extractXmlTag(xml, ["PaymentMeansCode"]) ?? "NO_IDENTIFICADO",
      medio_pago: extractXmlTag(xml, ["PaymentID"]) ?? "TRANSFERENCIA",
    },
    datos_emisor_vendedor: {
      razon_social: vendorName,
      nit: vendorTaxId,
    },
    datos_adquiriente_comprador: {
      nombre_razon_social: customerName,
      numero_documento: customerTaxId,
    },
    totales: {
      moneda: currency,
      subtotal,
      iva: taxAmount,
      total_factura: totalAmount,
      total_impuesto: taxAmount,
    },
    items: finalLineItems,
  } satisfies Record<string, unknown>;

  return {
    invoiceId,
    invoice_number: invoiceNumber,
    vendor_name: vendorName,
    vendor_tax_id: vendorTaxId,
    customer_name: customerName,
    customer_tax_id: customerTaxId,
    total_amount: totalAmount,
    tax_amount: taxAmount,
    currency,
    raw_data: rawData,
    dian_invoice: {
      batch_id: batchId,
      doc_numero_factura: invoiceNumber,
      doc_fecha_emision: issueDate,
      doc_fecha_vencimiento: dueDate,
      doc_forma_pago: extractXmlTag(xml, ["PaymentMeansCode"]) ?? "NO_IDENTIFICADO",
      doc_medio_pago: extractXmlTag(xml, ["PaymentID"]) ?? "TRANSFERENCIA",
      emisor_razon_social: vendorName,
      emisor_nit: vendorTaxId,
      adquiriente_nombre_razon_social: customerName,
      adquiriente_numero_documento: customerTaxId,
      tot_moneda: currency,
      tot_subtotal: subtotal,
      tot_total_impuesto: taxAmount,
      tot_total_factura: totalAmount,
      estado: "extraida",
      json_crudo: rawData,
    },
    dian_details: finalLineItems.map((item) => ({
      detalle_nro: item.nro,
      detalle_codigo: item.codigo,
      detalle_descripcion: item.descripcion,
      detalle_cantidad: item.cantidad,
      detalle_precio_unitario: item.precio_unitario,
      detalle_impuesto_iva: item.impuesto_iva,
      detalle_precio_unitario_venta: item.precio_unitario_venta,
    })),
  };
}

async function buildInvoiceSeed(file: File, batchId: string): Promise<InvoiceSeed> {
  const invoiceId = crypto.randomUUID();
  const isXml = file.type.includes("xml") || file.name.toLowerCase().endsWith(".xml");
  const isZip = file.type.includes("zip") || file.name.toLowerCase().endsWith(".zip");
  const isPdf = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");

  if (isZip) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const zip = new AdmZip(buffer);
      const xmlEntry = zip
        .getEntries()
        .find((entry: AdmZip.IZipEntry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith(".xml"));

      if (xmlEntry) {
        const xmlContent = zip.readAsText(xmlEntry, "utf8");
        const xmlName = xmlEntry.entryName.split("/").pop() || file.name;
        return buildInvoiceSeedFromXml(xmlName, xmlContent, batchId, invoiceId);
      }
    } catch {
      // Fallback a placeholder si el ZIP no puede leerse.
    }
  }

  if (isPdf) {
    try {
      return await buildInvoiceSeedFromPdf(file, batchId, invoiceId);
    } catch {
      // Fallback controlado a placeholder si el parser PDF falla.
    }
  }

  if (!isXml) {
    const fallbackNumber = `${fileBaseName(file.name).slice(0, 40) || "DOC"}-${batchId.slice(0, 8)}`;
    const rawData = {
      origen_extraccion: "placeholder",
      datos_documento: {
        numero_factura: fallbackNumber,
        fecha_emision: new Date().toISOString(),
        forma_pago: "POR_DEFINIR",
        medio_pago: "ARCHIVO_CARGADO",
      },
      datos_emisor_vendedor: {
        razon_social: "Pendiente de extraccion",
        nit: null,
      },
      datos_adquiriente_comprador: {
        nombre_razon_social: "Pendiente de extraccion",
        numero_documento: null,
      },
      totales: {
        moneda: "COP",
        subtotal: null,
        iva: null,
        total_factura: null,
      },
      items: [
        {
          nro: 1,
          codigo: file.name,
          descripcion: `Archivo cargado: ${file.name}`,
          cantidad: 1,
          precio_unitario: null,
        },
      ],
    } satisfies Record<string, unknown>;

    return {
      invoiceId,
      invoice_number: fallbackNumber,
      vendor_name: "Pendiente de extraccion",
      vendor_tax_id: null,
      customer_name: "Pendiente de extraccion",
      customer_tax_id: null,
      total_amount: null,
      tax_amount: null,
      currency: "COP",
      raw_data: rawData,
      dian_invoice: {
        batch_id: batchId,
        doc_numero_factura: fallbackNumber,
        doc_fecha_emision: new Date().toISOString(),
        doc_forma_pago: "POR_DEFINIR",
        doc_medio_pago: "ARCHIVO_CARGADO",
        emisor_razon_social: "Pendiente de extraccion",
        adquiriente_nombre_razon_social: "Pendiente de extraccion",
        tot_moneda: "COP",
        estado: "pendiente_revision",
        json_crudo: rawData,
      },
      dian_details: [
        {
          detalle_nro: 1,
          detalle_codigo: file.name,
          detalle_descripcion: `Archivo cargado: ${file.name}`,
          detalle_cantidad: 1,
        },
      ],
    };
  }

  const xml = await file.text();
  return buildInvoiceSeedFromXml(file.name, xml, batchId, invoiceId);
}

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

async function resolveTenantId(supabase: ReturnType<typeof getSupabaseAdminClient>): Promise<string | null> {
  if (!supabase) return null;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const tenantRecord = tenant as { id?: string } | null;

  if (tenantRecord?.id) return tenantRecord.id;

  const { data: existingInvoice } = await supabase
    .from("invoices")
    .select("tenant_id")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();

  const invoiceRecord = existingInvoice as { tenant_id?: string } | null;

  return invoiceRecord?.tenant_id ?? null;
}

async function getTenantIdFromRequest(
  request: NextRequest,
  supabase: ReturnType<typeof getSupabaseAdminClient>
): Promise<string | null> {
  if (!supabase) return null;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      const { data: userRecord } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      const rec = userRecord as { tenant_id?: string } | null;
      if (rec?.tenant_id) return rec.tenant_id;
    }
  }

  // Fallback: primer tenant disponible (single-tenant deployments)
  return resolveTenantId(supabase);
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(request.nextUrl.searchParams.get("page_size") ?? "20");
  const status = request.nextUrl.searchParams.get("status");

  if (!supabase) {
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  const tenantId = await getTenantIdFromRequest(request, supabase);
  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize - 1;

  let query = supabase
    .from("batches")
    .select("id, filename, file_size, file_type, status, total_invoices, processed_invoices, failed_invoices, celery_task_id, error_message, tenant_id", { count: "exact" })
    .range(from, to)
    .order("created_at", { ascending: false });

  if (tenantId) query = query.eq("tenant_id", tenantId);
  if (status) query = query.eq("status", status);

  const { data, count, error } = await query;

  if (error) {
    // If table does not exist yet, return a safe empty response.
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  return NextResponse.json({
    total: count ?? (data?.length ?? 0),
    page,
    page_size: pageSize,
    items: (data ?? []) as BatchRow[],
  });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ detail: "File is required" }, { status: 400 });
  }

  const batch: BatchRow = {
    id: crypto.randomUUID(),
    filename: file.name,
    file_size: file.size,
    file_type: file.type || "application/octet-stream",
    status: "uploaded",
    total_invoices: 0,
    processed_invoices: 0,
    failed_invoices: 0,
    celery_task_id: null,
    error_message: null,
  };

  if (!supabase) {
    return NextResponse.json(batch, { status: 201 });
  }

  const tenantId = await getTenantIdFromRequest(request, supabase);

  const batchPayload: Record<string, unknown> = {
    id: batch.id,
    filename: batch.filename,
    file_size: batch.file_size,
    file_type: batch.file_type,
    status: batch.status,
    total_invoices: 0,
    processed_invoices: 0,
    failed_invoices: 0,
  };
  if (tenantId) batchPayload.tenant_id = tenantId;

  const { data, error } = await supabase
    .from("batches")
    .insert(batchPayload)
    .select("id, filename, file_size, file_type, status, total_invoices, processed_invoices, failed_invoices, celery_task_id, error_message, tenant_id")
    .single();

  if (error) {
    // Keep the app functional even when optional table is not ready.
    return NextResponse.json(batch, { status: 201 });
  }

  const seed = await buildInvoiceSeed(file, batch.id);

  const invoicePayload: Record<string, unknown> = {
    id: seed.invoiceId,
    batch_id: batch.id,
    invoice_number: seed.invoice_number,
    vendor_name: seed.vendor_name,
    vendor_tax_id: seed.vendor_tax_id,
    amount: seed.total_amount ?? 0,
    total_amount: seed.total_amount,
    tax_amount: seed.tax_amount,
    currency: seed.currency,
    invoice_date: typeof seed.dian_invoice.doc_fecha_emision === "string"
      ? seed.dian_invoice.doc_fecha_emision.slice(0, 10)
      : null,
    status: "parsed",
  };

  if (tenantId) {
    invoicePayload.tenant_id = tenantId;
  }

  const { error: invoiceError } = await supabase.from("invoices").insert(invoicePayload);

  let dianErrorMessage: string | null = null;

  if (!invoiceError) {
    const { data: dianInvoice, error: dianInvoiceError } = await supabase
      .from("facturas_dian")
      .insert({
        ...seed.dian_invoice,
      })
      .select("id")
      .single();

    if (dianInvoiceError) {
      dianErrorMessage = dianInvoiceError.message;
    } else if (dianInvoice?.id) {
      // Solo insertar detalle si hay líneas reales (no insertar fila fantasma)
      let dianDetailError: { message: string } | null = null;
      if (seed.dian_details.length > 0) {
        const detailPayload = seed.dian_details.map((detail) => ({
          factura_id: dianInvoice.id,
          ...detail,
        }));
        const { error: detailErr } = await supabase
          .from("facturas_dian_detalle")
          .insert(detailPayload);
        if (detailErr) {
          dianDetailError = detailErr;
          dianErrorMessage = detailErr.message;
        }
      } else {
        // Sin líneas extraídas: marcar la factura para revisión
        await supabase
          .from("facturas_dian")
          .update({ estado: "parsed_with_warnings" })
          .eq("id", dianInvoice.id);
      }

      // ── Motor tributario: siempre calcular si hay canonical ──────────────
      // Se ejecuta incluso cuando no hay líneas de detalle (calcula sobre totales)
      if (seed.canonical) {
        try {
          const taxConfig = getDefaultTaxRulesConfig();
          // ── Contexto contable por proveedor (Task 19.1) ──────────────────────
          const classifyCtx = supabase && tenantId
            ? await loadClassifyContext({
                supabase,
                tenantId,
                supplierNit: seed.canonical.datos_emisor_vendedor_nit_emisor.value ?? null,
              }).catch(() => undefined)
            : undefined;
          const taxResult = calculateInvoiceTaxes(seed.canonical, taxConfig, {
            supplier_city: seed.canonical.datos_emisor_vendedor_municipio_ciudad.value ?? undefined,
            buyer_city: seed.canonical.datos_adquiriente_comprador_municipio_ciudad.value ?? undefined,
            classify_context: classifyCtx,
          });

          const taxPayload: Record<string, unknown> = {
            batch_id: batch.id,
            invoice_id: seed.invoiceId,
            factura_dian_id: dianInvoice.id,
            invoice_number: taxResult.invoice_number,
            supplier_nit: taxResult.supplier_nit ?? null,
            supplier_name: taxResult.supplier_name ?? null,
            buyer_nit: taxResult.buyer_nit ?? null,
            buyer_name: taxResult.buyer_name ?? null,
            city: taxResult.city ?? null,
            subtotal: taxResult.subtotal,
            iva_total: taxResult.iva_total,
            inc_total: taxResult.inc_total,
            total_invoice: taxResult.total_invoice,
            retefuente_calculated: taxResult.totals.retefuente,
            reteica_calculated: taxResult.totals.reteica,
            reteiva_calculated: taxResult.totals.reteiva,
            retefuente_reported: taxResult.reported_withholdings.retefuente,
            reteica_reported: taxResult.reported_withholdings.reteica,
            reteiva_reported: taxResult.reported_withholdings.reteiva,
            retefuente_difference: taxResult.differences.retefuente,
            reteica_difference: taxResult.differences.reteica,
            reteiva_difference: taxResult.differences.reteiva,
            requires_review: taxResult.requires_review || seed.dian_details.length === 0,
            warnings_json: taxResult.warnings,
            result_json: taxResult,
          };
          if (tenantId) taxPayload.tenant_id = tenantId;

          const { error: taxInsertErr } = await supabase
            .from("invoice_tax_calculations")
            .insert(taxPayload);
          if (taxInsertErr) {
            console.error("Tax calculation insert error:", taxInsertErr.message);
          }
        } catch (taxErr) {
          console.error("Tax calculation error (non-blocking):", taxErr);
        }
      }

      // Suprimir el dianDetailError para que el batch quede "completed"
      // (el detalle vacío es una advertencia, no un fallo de extracción)
      if (dianDetailError && seed.dian_details.length === 0) {
        dianErrorMessage = null;
      }
    }
  }

  const finalStatus = invoiceError ? "failed" : "completed";
  const finalError = invoiceError?.message ?? dianErrorMessage;

  const { data: updatedBatch } = await supabase
    .from("batches")
    .update({
      status: finalStatus,
      total_invoices: invoiceError ? 0 : 1,
      processed_invoices: invoiceError ? 0 : 1,
      failed_invoices: invoiceError ? 1 : 0,
      error_message: finalError,
    })
    .eq("id", batch.id)
    .select("id, filename, file_size, file_type, status, total_invoices, processed_invoices, failed_invoices, celery_task_id, error_message, tenant_id")
    .single();

  return NextResponse.json((updatedBatch ?? data) as BatchRow, { status: 201 });
}
