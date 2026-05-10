/**
 * Cliente HTTP centralizado para la API backend.
 * Adjunta automáticamente el Authorization header y maneja errores 401.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

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
    // For other endpoints, use API_BASE
    url = new URL(`${API_BASE}${path}`);
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
    throw new Error(extractErrorMessage(body, res.status));
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

export async function uploadBatch(file: File): Promise<Batch> {
  const form = new FormData();
  form.append("file", file);

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/invoices/batches`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Invoices ──────────────────────────────────────────────────────────────────
export interface Invoice {
  id: string;
  batch_id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  vendor_tax_id: string | null;
  total_amount: number | null;
  tax_amount: number | null;
  currency: string;
  status: string;
}

export async function listBatchInvoices(batchId: string, page = 1, pageSize = 50) {
  return apiFetch<PaginatedResponse<Invoice>>(`/invoices/batches/${batchId}/invoices`, {
    params: { page, page_size: pageSize },
  });
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
