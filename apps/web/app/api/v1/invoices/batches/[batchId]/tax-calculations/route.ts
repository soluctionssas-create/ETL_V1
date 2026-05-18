/**
 * GET /api/v1/invoices/batches/:batchId/tax-calculations
 *
 * Devuelve los cálculos tributarios de las facturas de un lote.
 *
 * Filtros opcionales por query string:
 *   ?nit=...              supplier_nit OR buyer_nit (ILIKE, normalizado)
 *   ?supplierNit=...      solo supplier_nit (eq exacto, normalizado)
 *   ?buyerNit=...         solo buyer_nit (eq exacto, normalizado)
 *   ?supplierName=...     supplier_name ILIKE %...%
 *   ?buyerName=...        buyer_name ILIKE %...%
 *   ?name=...             supplier_name OR buyer_name ILIKE %...%
 *   ?requiresReview=true  solo requires_review = true
 *   ?limit=50             máximo de resultados (cap: 200)
 *   ?offset=0             desplazamiento para paginación
 *
 * Seguridad:
 *   - tenant_id se resuelve server-side desde el Bearer token o
 *     desde el primer tenant disponible (single-tenant deployment).
 *   - Todas las consultas incluyen .eq("tenant_id", tenantId).
 *   - NITs y textos se normalizan antes de enviarse al query builder.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildTaxCalculationFilters } from "@/lib/tax/tax-calculation-filters";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Supabase admin client
// ---------------------------------------------------------------------------
function supabaseAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Resolución de tenant_id (mismo patrón que batches/[batchId]/route.ts)
// ---------------------------------------------------------------------------
async function getTenantId(
  req: NextRequest,
  supabase: ReturnType<typeof supabaseAdmin>
): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (!error && user) {
      const { data: record } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      const r = record as { tenant_id?: string } | null;
      if (r?.tenant_id) return r.tenant_id;
    }
  }
  // Fallback single-tenant
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (tenant as { id?: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Columnas a seleccionar (columnas confirmadas en supabase_tax_calculation_results.sql)
// ---------------------------------------------------------------------------
const SELECT_FIELDS = [
  "id",
  "invoice_id",
  "factura_dian_id",
  "invoice_number",
  "supplier_nit",
  "supplier_name",
  "buyer_nit",
  "buyer_name",
  "city",
  "subtotal",
  "iva_total",
  "inc_total",
  "total_invoice",
  "retefuente_calculated",
  "reteica_calculated",
  "reteiva_calculated",
  "retefuente_reported",
  "reteica_reported",
  "reteiva_reported",
  "retefuente_difference",
  "reteica_difference",
  "reteiva_difference",
  "requires_review",
  "warnings_json",
  "result_json",
  "created_at",
].join(", ");

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const supabase = supabaseAdmin();

    const tenantId = await getTenantId(req, supabase);
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant no identificado" },
        { status: 401 }
      );
    }

    const filters = buildTaxCalculationFilters(req.nextUrl.searchParams);

    let query = supabase
      .from("invoice_tax_calculations")
      .select(SELECT_FIELDS)
      .eq("batch_id", batchId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1);

    // ── NIT filters ────────────────────────────────────────────────────────
    if (filters.supplierNit) {
      query = query.eq("supplier_nit", filters.supplierNit);
    }
    if (filters.buyerNit) {
      query = query.eq("buyer_nit", filters.buyerNit);
    }
    if (filters.nit) {
      query = query.or(
        `supplier_nit.ilike.%${filters.nit}%,buyer_nit.ilike.%${filters.nit}%`
      );
    }

    // ── Name filters ───────────────────────────────────────────────────────
    if (filters.supplierName) {
      query = query.ilike("supplier_name", `%${filters.supplierName}%`);
    }
    if (filters.buyerName) {
      query = query.ilike("buyer_name", `%${filters.buyerName}%`);
    }
    if (filters.name) {
      query = query.or(
        `supplier_name.ilike.%${filters.name}%,buyer_name.ilike.%${filters.name}%`
      );
    }

    // ── Review filter ──────────────────────────────────────────────────────
    if (filters.requiresReview !== undefined) {
      query = query.eq("requires_review", filters.requiresReview);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Construir objeto de filtros aplicados para la respuesta (solo los activos)
    const appliedFilters: Record<string, string | boolean | undefined> = {
      batchId,
    };
    if (filters.nit !== undefined) appliedFilters.nit = filters.nit;
    if (filters.supplierNit !== undefined)
      appliedFilters.supplierNit = filters.supplierNit;
    if (filters.buyerNit !== undefined) appliedFilters.buyerNit = filters.buyerNit;
    if (filters.supplierName !== undefined)
      appliedFilters.supplierName = filters.supplierName;
    if (filters.buyerName !== undefined) appliedFilters.buyerName = filters.buyerName;
    if (filters.name !== undefined) appliedFilters.name = filters.name;
    if (filters.requiresReview !== undefined)
      appliedFilters.requiresReview = filters.requiresReview;

    return NextResponse.json({
      items: data ?? [],
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        count: data?.length ?? 0,
      },
      filters: appliedFilters,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
