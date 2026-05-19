/**
 * Cliente HTTP centralizado para la API backend.
 * Adjunta automáticamente el Authorization header y maneja errores 401.
 */

/**
 * Elimina caracteres invisibles (BOM U+FEFF, zero-width spaces, etc.) y
 * espacios extremos del valor de la variable de entorno antes de usarlo
 * como base URL.
 *
 * Antecedente: NEXT_PUBLIC_API_URL fue guardada en Vercel con un BOM al
 * inicio (\uFEFF/api/v1). Al bakear el valor en el bundle JS, el browser
 * construía URLs como /%EF%BB%BF/api/v1/... → HTTP 404.
 * Fix aplicado: Task 14 (2026-05-18).
 */
export function normalizeApiBaseUrl(raw: string | undefined): string {
  if (!raw) return "/api/v1";
  const stripped = raw
    .replace(/\uFEFF/g, "")                   // BOM (U+FEFF)
    .replace(/[\u200B\u200C\u200D\u2060]/g, "") // zero-width chars
    .trim();
  return stripped || "/api/v1";
}

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);

type FetchOptions = RequestInit & { params?: Record<string, string | number | undefined> };

function extractErrorMessage(body: unknown, status: number): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    const message = (body as { message?: unknown }).message;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
        .join(" | ");
    }
    if (detail && typeof detail === "object") return JSON.stringify(detail);
    if (typeof message === "string") return message;
  }
  return `HTTP ${status}`;
}

function readTenantFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const parsed = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      tenant_id?: string;
    };
    return parsed.tenant_id ?? null;
  } catch {
    return null;
  }
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOpts } = options;

  // Use Next.js API routes for auth endpoints (no need for external backend)
  // Use API_BASE for other endpoints (batches, invoices, etc.)
  const isAuthEndpoint = path.startsWith("/auth/");
  let url: URL;
  
  if (isAuthEndpoint) {
    // For auth endpoints, use relative path to /api/auth/*
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3010";
    url = new URL(`/api${path}`, baseUrl);
  } else {
    // For other endpoints, use API_BASE (external URL or internal /api/v1)
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3010";
    url = new URL(`${API_BASE}${path}`, baseUrl);
  }

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v));
    });
  }

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const tenant =
    typeof window !== "undefined"
      ? localStorage.getItem("active_tenant") ?? readTenantFromToken(token)
      : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOpts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (tenant) headers["X-Tenant-Id"] = tenant;
  headers["X-Correlation-Id"] = crypto.randomUUID();

  const res = await fetch(url.toString(), { ...fetchOpts, headers });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const errMsg = extractErrorMessage(body, res.status);
    // Logging estructurado para Vercel — visible en Runtime Logs y browser console
    console.error(
      `[API_ERROR] ${fetchOpts.method ?? "GET"} ${url.pathname} → ${res.status}`,
      JSON.stringify({
        correlationId: headers["X-Correlation-Id"],
        tenant: tenant ?? "unknown",
        status: res.status,
        error: errMsg,
        ts: new Date().toISOString(),
      })
    );
    throw new Error(errMsg);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
  tenant_slug: string;
  tenant_name: string;
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  return apiFetch<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(payload: RegisterPayload) {
  return apiFetch<{ id: string; email: string; full_name: string; role: string; tenant_id: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getMe() {
  return apiFetch<{ id: string; email: string; full_name: string; role: string }>("/auth/me");
}

// ── Batches ───────────────────────────────────────────────────────────────────
export interface Batch {
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
}

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export async function listBatches(page = 1, pageSize = 20, status?: string) {
  return apiFetch<PaginatedResponse<Batch>>("/invoices/batches", {
    params: { page, page_size: pageSize, status },
  });
}

export async function getBatch(batchId: string) {
  return apiFetch<Batch>(`/invoices/batches/${batchId}`);
}

export async function uploadBatch(files: File[]): Promise<Batch[]> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const results: Batch[] = [];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`${API_BASE}/invoices/batches`, {
      method: "POST",
      headers,
      body: form,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.detail ?? `HTTP ${res.status}`);
    }

    results.push((await res.json()) as Batch);
  }

  return results;
}

// ── Invoices ──────────────────────────────────────────────────────────────────
export interface InvoiceItem {
  line_number?: string | null;
  item_code?: string | null;
  item_description?: string | null;
  unit?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  discount?: number | null;
  surcharge?: number | null;
  tax_iva?: number | null;
  tax_iva_rate?: number | null;
  tax_inc?: number | null;
  tax_inc_rate?: number | null;
  sale_unit_price?: number | null;
}

export interface Invoice {
  id: string;
  batch_id: string;
  invoice_number: string | null;
  document_type?: string | null;
  cufe_cude?: string | null;
  folio?: string | null;
  prefix?: string | null;
  vendor_name: string | null;
  vendor_tax_id: string | null;
  receiver_name?: string | null;
  receiver_tax_id?: string | null;
  total_amount: number | null;
  tax_amount: number | null;
  currency: string;
  payment_form?: string | null;
  payment_method?: string | null;
  issue_date?: string | null;
  reception_date?: string | null;
  item_code?: string | null;
  item_description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  iva?: number | null;
  ica?: number | null;
  ic?: number | null;
  inc?: number | null;
  timbre?: number | null;
  inc_bolsas?: number | null;
  in_carbono?: number | null;
  in_combustibles?: number | null;
  ic_datos?: number | null;
  icl?: number | null;
  inpp?: number | null;
  ibua?: number | null;
  icui?: number | null;
  rete_iva?: number | null;
  rete_renta?: number | null;
  rete_ica?: number | null;
  group_name?: string | null;

  // Alias en espanol para facilitar integracion funcional.
  doc_numero_factura?: string | null;
  doc_fecha_emision?: string | null;
  doc_fecha_vencimiento?: string | null;
  doc_tipo_operacion?: string | null;
  doc_forma_pago?: string | null;
  doc_medio_pago?: string | null;
  doc_orden_pedido?: string | null;
  doc_fecha_orden_pedido?: string | null;
  emisor_razon_social?: string | null;
  emisor_nombre_comercial?: string | null;
  emisor_nit?: string | null;
  emisor_tipo_contribuyente?: string | null;
  emisor_regimen_fiscal?: string | null;
  emisor_responsabilidad_tributaria?: string | null;
  emisor_actividad_economica?: string | null;
  emisor_pais?: string | null;
  emisor_departamento?: string | null;
  emisor_ciudad?: string | null;
  emisor_direccion?: string | null;
  emisor_telefono?: string | null;
  emisor_correo?: string | null;
  adquiriente_nombre_razon_social?: string | null;
  adquiriente_tipo_documento?: string | null;
  adquiriente_numero_documento?: string | null;
  adquiriente_tipo_contribuyente?: string | null;
  adquiriente_regimen_fiscal?: string | null;
  adquiriente_responsabilidad_tributaria?: string | null;
  adquiriente_pais?: string | null;
  adquiriente_departamento?: string | null;
  adquiriente_ciudad?: string | null;
  adquiriente_direccion?: string | null;
  adquiriente_telefono?: string | null;
  adquiriente_correo?: string | null;
  detalle_nro?: string | null;
  detalle_codigo?: string | null;
  detalle_descripcion?: string | null;
  detalle_um?: string | null;
  detalle_cantidad?: number | null;
  detalle_precio_unitario?: number | null;
  detalle_descuento?: number | null;
  detalle_recargo?: number | null;
  detalle_impuesto_iva?: number | null;
  detalle_porcentaje_iva?: number | null;
  detalle_impuesto_inc?: number | null;
  detalle_porcentaje_inc?: number | null;
  detalle_precio_unitario_venta?: number | null;
  tot_moneda?: string | null;
  tot_subtotal?: number | null;
  tot_descuento_detalle?: number | null;
  tot_recargo_detalle?: number | null;
  tot_total_bruto_factura?: number | null;
  tot_iva?: number | null;
  tot_inc?: number | null;
  tot_bolsas?: number | null;
  tot_otros_impuestos?: number | null;
  tot_total_impuesto?: number | null;
  tot_total_neto_factura?: number | null;
  tot_descuento_global?: number | null;
  tot_recargo_global?: number | null;
  tot_total_factura?: number | null;
  tot_anticipos?: number | null;
  tot_rete_fuente?: number | null;
  tot_rete_iva?: number | null;
  tot_rete_ica?: number | null;
  items?: InvoiceItem[];
  raw_data?: Record<string, unknown> | null;
  status: string;
}

export async function listBatchInvoices(batchId: string, page = 1, pageSize = 50) {
  return apiFetch<PaginatedResponse<Invoice>>(`/invoices/batches/${batchId}/invoices`, {
    params: { page, page_size: pageSize },
  });
}

// ── Tax Calculations ──────────────────────────────────────────────────────────

/** Línea individual clasificada por el motor tributario */
export interface ClassifiedLine {
  line_id: string;
  source_line_number: number;
  description: string;
  code?: string | null;
  quantity: number;
  line_base: number;
  iva_amount: number;
  iva_rate: number;
  inc_amount: number;
  kind: "purchase" | "service" | "mixed" | "unknown";
  retefuente_concept?: string;
  retefuente_account?: string;
  reteica_city?: string;
  reteica_kind?: "service" | "purchase";
  confidence: number;
  reasons: string[];
  requires_review: boolean;
  // ── Sugerencia contable (Task 19) ─────────────────────────────────────────
  suggested_account_code?: string | null;
  suggested_account_name?: string | null;
  payable_account_code?: string | null;
  cost_or_expense?: "cost" | "expense" | "asset" | "liability" | "unknown";
  memory_source?: "manual" | "history" | "rule/ciiu" | "rule/kind" | "default";
}

/** Grupo de base tributaria calculado por el motor */
export interface TaxBaseGroup {
  tax_type: "retefuente" | "reteica" | "reteiva";
  group_key: string;
  concept: string;
  account_code: string;
  legal_reference?: string;
  base: number;
  threshold_base: number;
  rate: number;
  calculated_amount: number;
  applies: boolean;
  reasons: string[];
}

/** Clasificación manual guardada dentro de result_json */
export interface ManualClassification {
  cost_or_expense?: string;
  account_code?: string;
  payable_account_code?: string;
  retefuente_concept?: string;
  reteica_city?: string;
  reteica_kind?: string;
  applied_at?: string;
  reason?: string;
}

/** Contenido de invoice_tax_calculations.result_json */
export interface TaxCalculationResult {
  invoice_number?: string;
  supplier_nit?: string;
  supplier_name?: string;
  classified_lines?: ClassifiedLine[];
  groups?: TaxBaseGroup[];
  totals?: { retefuente: number; reteica: number; reteiva: number };
  reported_withholdings?: { retefuente: number; reteica: number; reteiva: number };
  differences?: { retefuente: number; reteica: number; reteiva: number };
  requires_review?: boolean;
  warnings?: string[];
  manual_classification?: ManualClassification;
}

/** Fila de la tabla invoice_tax_calculations */
export interface TaxCalculation {
  id: string;
  invoice_id: string;
  factura_dian_id?: string | null;
  invoice_number: string | null;
  supplier_nit: string | null;
  supplier_name: string | null;
  buyer_nit: string | null;
  buyer_name: string | null;
  city: string | null;
  subtotal: number | null;
  iva_total: number | null;
  inc_total: number | null;
  total_invoice: number | null;
  retefuente_calculated: number | null;
  reteica_calculated: number | null;
  reteiva_calculated: number | null;
  retefuente_reported: number | null;
  reteica_reported: number | null;
  reteiva_reported: number | null;
  retefuente_difference: number | null;
  reteica_difference: number | null;
  reteiva_difference: number | null;
  requires_review: boolean;
  warnings_json: string[] | null;
  result_json: TaxCalculationResult | null;
  created_at: string;
}

export interface TaxCalculationListParams {
  nit?: string;
  supplierNit?: string;
  buyerNit?: string;
  supplierName?: string;
  buyerName?: string;
  name?: string;
  requiresReview?: boolean;
  limit?: number;
  offset?: number;
}

export interface TaxCalculationListResponse {
  items: TaxCalculation[];
  pagination: { limit: number; offset: number; count: number };
  filters: Record<string, unknown>;
}

export async function listTaxCalculations(
  batchId: string,
  params: TaxCalculationListParams = {},
): Promise<TaxCalculationListResponse> {
  const queryParams: Record<string, string | number | undefined> = {
    limit: params.limit ?? 200,
    offset: params.offset ?? 0,
  };
  if (params.nit) queryParams.nit = params.nit;
  if (params.supplierNit) queryParams.supplierNit = params.supplierNit;
  if (params.buyerNit) queryParams.buyerNit = params.buyerNit;
  if (params.supplierName) queryParams.supplierName = params.supplierName;
  if (params.buyerName) queryParams.buyerName = params.buyerName;
  if (params.name) queryParams.name = params.name;
  if (params.requiresReview !== undefined)
    queryParams.requiresReview = String(params.requiresReview);
  return apiFetch<TaxCalculationListResponse>(
    `/invoices/batches/${batchId}/tax-calculations`,
    { params: queryParams },
  );
}

export interface ReclassifyInvoicePayload {
  cost_or_expense?: "cost" | "expense" | "asset" | "liability" | "unknown";
  account_code?: string;
  payable_account_code?: string;
  retefuente_concept?: string;
  reteica_city?: string;
  reteica_kind?: "service" | "purchase";
  mark_as_reviewed?: boolean;
  reason: string;
}

export interface ReclassifyInvoiceResult {
  ok: boolean;
  invoice_id: string;
  calculation_updated: boolean;
  memory_updated: boolean;
  audit_rows_created: number;
  warnings?: string[];
}

/** Reclasifica una factura por su invoice_number (no UUID). */
export async function reclassifyInvoice(
  invoiceNumber: string,
  payload: ReclassifyInvoicePayload,
): Promise<ReclassifyInvoiceResult> {
  return apiFetch<ReclassifyInvoiceResult>(
    `/invoices/${encodeURIComponent(invoiceNumber)}/reclassify`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export interface ReclassifyLinePayload {
  kind?: "purchase" | "service" | "mixed" | "unknown";
  account_code?: string;
  retefuente_concept?: string;
  reteica_kind?: "service" | "purchase";
  exclude_from_withholding?: boolean;
  reason: string;
}

export interface ReclassifyLineResult {
  ok: boolean;
  invoice_id: string;
  line_id: string;
  calculation_updated: boolean;
  classification_memory_updated: boolean;
  audit_rows_created: number;
  warnings?: string[];
}

export async function reclassifyLine(
  invoiceNumber: string,
  lineId: string,
  payload: ReclassifyLinePayload,
): Promise<ReclassifyLineResult> {
  return apiFetch<ReclassifyLineResult>(
    `/invoices/${encodeURIComponent(invoiceNumber)}/lines/${encodeURIComponent(lineId)}/reclassify`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────
export interface ExportJob {
  id: string;
  erp_system: string;
  status: string;
  total_records: number;
  exported_records: number;
  error_message: string | null;
}

export async function triggerExport(batchId: string, erpSystem: string): Promise<ExportJob> {
  return apiFetch<ExportJob>("/exports/run", {
    method: "POST",
    body: JSON.stringify({ batch_id: batchId, erp_system: erpSystem }),
  });
}
