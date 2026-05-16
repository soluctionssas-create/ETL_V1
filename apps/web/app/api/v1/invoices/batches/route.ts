import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import { createRequire } from "node:module";

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
  const parsed = await pdfParse(buffer);
  const text = parsed.text ?? "";
  const lines: string[] = text
    .split(/\r?\n/)
    .map((line: string) => sanitizeText(line) ?? "")
    .filter((line: string) => line.length > 2);

  const fullText = lines.join(" \n ");
  const invoiceNumberMatch = fullText.match(/(?:numero\s*de\s*factura|nro\.?\s*factura|factura\s*(?:no\.?|nro\.?)?)\s*[:#-]?\s*([A-Z0-9-]{4,})/i);
  const dateIssueMatch = fullText.match(/(?:fecha\s*(?:de)?\s*emisi[oó]n|fecha)\s*[:#-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
  const dateDueMatch = fullText.match(/(?:fecha\s*(?:de)?\s*vencimiento|vencimiento)\s*[:#-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
  const paymentFormMatch = fullText.match(/forma\s*de\s*pago\s*[:#-]?\s*([A-Z0-9]{1,10})/i);
  const paymentMethodMatch = fullText.match(/medio\s*de\s*pago\s*[:#-]?\s*([A-Z\s]{3,30})/i);
  const nitMatches = Array.from(fullText.matchAll(/\b\d{8,12}\b/g)).map((match: RegExpMatchArray) => match[0]);

  const totalLine = lines.find((line: string) => /total\s*(factura|a\s*pagar|documento)?/i.test(line)) ?? "";
  const totalMoneyMatch = Array.from(totalLine.matchAll(/\b\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})\b|\b\d+(?:,\d{2})\b/g)).map((match: RegExpMatchArray) => match[0]);

  const extractedItems = extractPdfItems(lines, file.name);
  const finalItems = extractedItems.length > 0
    ? extractedItems
    : [
        {
          nro: 1,
          codigo: file.name,
          descripcion: `Archivo PDF cargado: ${file.name}`,
          cantidad: 1,
          precio_unitario: null,
          impuesto_iva: null,
          precio_unitario_venta: null,
        },
      ];

  const invoiceNumber = sanitizeText(invoiceNumberMatch?.[1] ?? null) ?? `${fileBaseName(file.name).slice(0, 40) || "PDF"}-${batchId.slice(0, 8)}`;
  const issueDate = parseDateToIso(dateIssueMatch?.[1] ?? null) ?? new Date().toISOString();
  const dueDate = parseDateToIso(dateDueMatch?.[1] ?? null);
  const vendorTaxId = nitMatches[0] ?? null;
  const customerTaxId = nitMatches[1] ?? null;
  const totalAmount = asNullableNumber(totalMoneyMatch[totalMoneyMatch.length - 1] ?? null);
  const taxAmount = null;

  const rawData = {
    origen_extraccion: "pdf_texto_basico",
    texto_plano: text.slice(0, 15000),
    datos_documento: {
      numero_factura: invoiceNumber,
      fecha_emision: issueDate,
      fecha_vencimiento: dueDate,
      forma_pago: sanitizeText(paymentFormMatch?.[1] ?? null) ?? "POR_DEFINIR",
      medio_pago: sanitizeText(paymentMethodMatch?.[1] ?? null) ?? "NO_IDENTIFICADO",
    },
    datos_emisor_vendedor: {
      razon_social: "Pendiente de extraccion PDF",
      nit: vendorTaxId,
    },
    datos_adquiriente_comprador: {
      nombre_razon_social: "Pendiente de extraccion PDF",
      numero_documento: customerTaxId,
    },
    totales: {
      moneda: "COP",
      subtotal: null,
      iva: taxAmount,
      total_factura: totalAmount,
      total_impuesto: taxAmount,
    },
    items: finalItems,
  } satisfies Record<string, unknown>;

  return {
    invoiceId,
    invoice_number: invoiceNumber,
    vendor_name: "Pendiente de extraccion PDF",
    vendor_tax_id: vendorTaxId,
    customer_name: "Pendiente de extraccion PDF",
    customer_tax_id: customerTaxId,
    total_amount: totalAmount,
    tax_amount: taxAmount,
    currency: "COP",
    raw_data: rawData,
    dian_invoice: {
      batch_id: batchId,
      doc_numero_factura: invoiceNumber,
      doc_fecha_emision: issueDate,
      doc_fecha_vencimiento: dueDate,
      doc_forma_pago: sanitizeText(paymentFormMatch?.[1] ?? null) ?? "POR_DEFINIR",
      doc_medio_pago: sanitizeText(paymentMethodMatch?.[1] ?? null) ?? "NO_IDENTIFICADO",
      emisor_razon_social: "Pendiente de extraccion PDF",
      emisor_nit: vendorTaxId,
      adquiriente_nombre_razon_social: "Pendiente de extraccion PDF",
      adquiriente_numero_documento: customerTaxId,
      tot_moneda: "COP",
      tot_total_impuesto: taxAmount,
      tot_total_factura: totalAmount,
      estado: extractedItems.length > 0 ? "extraida_pdf" : "pendiente_revision_pdf",
      json_crudo: rawData,
    },
    dian_details: finalItems.map((item) => ({
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

function buildInvoiceSeedFromXml(sourceName: string, xml: string, batchId: string, invoiceId: string): InvoiceSeed {
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
      const detailPayload = (seed.dian_details.length > 0 ? seed.dian_details : [{ detalle_nro: 1 }]).map((detail) => ({
        factura_id: dianInvoice.id,
        ...detail,
      }));

      const { error: dianDetailError } = await supabase.from("facturas_dian_detalle").insert(detailPayload);

      if (dianDetailError) {
        dianErrorMessage = dianDetailError.message;
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
