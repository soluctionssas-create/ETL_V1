/**
 * POST /api/v1/invoices/batches/:batchId/recalculate-tax
 *
 * Re-ejecuta el motor tributario para todas las facturas de un lote.
 * Procesa las facturas desde canonical_invoice_json en facturas_dian.
 * Hace upsert en invoice_tax_calculations (insert o update si ya existían).
 *
 * Respuesta:
 * {
 *   ok: true,
 *   processed: number,      // facturas procesadas correctamente
 *   skipped: number,        // facturas sin canonical_invoice_json
 *   errors: string[],       // errores no fatales
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateInvoiceTaxes } from "@/lib/tax/calculate-invoice-taxes";
import { getDefaultTaxRulesConfig } from "@/lib/tax/tax-rules-loader";
import { loadClassifyContext } from "@/lib/tax/load-classify-context";
import type { DianCanonicalInvoice } from "@/lib/dian/dian-canonical-types";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key);
}

async function resolveSession(
  req: NextRequest,
  supabase: ReturnType<typeof supabaseAdmin>
): Promise<{ tenantId: string | null }> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      const { data: record } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      const r = record as { tenant_id?: string } | null;
      if (r?.tenant_id) return { tenantId: r.tenant_id };
    }
  }
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const t = tenant as { id?: string } | null;
  return { tenantId: t?.id ?? null };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const supabase = supabaseAdmin();
    const { tenantId } = await resolveSession(req, supabase);

    if (!tenantId) {
      return NextResponse.json({ error: "Tenant no identificado" }, { status: 401 });
    }

    // Verificar que el batch pertenece al tenant
    const { data: batch, error: batchErr } = await supabase
      .from("batches")
      .select("id, tenant_id")
      .eq("id", batchId)
      .eq("tenant_id", tenantId)
      .single();

    if (batchErr || !batch) {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
    }

    // Obtener todas las facturas DIAN del lote con su canonical
    const { data: dianRows, error: dianErr } = await supabase
      .from("facturas_dian")
      .select("id, canonical_invoice_json")
      .eq("batch_id", batchId);

    if (dianErr) {
      return NextResponse.json({ error: dianErr.message }, { status: 500 });
    }

    // Obtener los invoices del batch para mapear factura_dian_id → invoice_id
    const { data: invoiceRows } = await supabase
      .from("invoices")
      .select("id, invoice_number")
      .eq("batch_id", batchId)
      .eq("tenant_id", tenantId);

    const invoiceMap = new Map<string, string>();
    for (const inv of invoiceRows ?? []) {
      const r = inv as { id: string; invoice_number: string };
      invoiceMap.set(r.invoice_number, r.id);
    }

    const taxConfig = getDefaultTaxRulesConfig();
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Cache de ClassifyContext por NIT — evita N consultas para el mismo proveedor (Task 19.1)
    type ClassifyCtx = Awaited<ReturnType<typeof loadClassifyContext>>;
    const classifyCtxCache = new Map<string, ClassifyCtx>();

    for (const row of dianRows ?? []) {
      const dian = row as { id: string; canonical_invoice_json: DianCanonicalInvoice | null };
      if (!dian.canonical_invoice_json) {
        skipped++;
        continue;
      }

      try {
        const canonical = dian.canonical_invoice_json;
        // ── Contexto contable por proveedor (Task 19.1) ──────────────────────
        const supplierNit = canonical.datos_emisor_vendedor_nit_emisor.value ?? null;
        let classifyCtx: ClassifyCtx | undefined;
        if (supplierNit) {
          if (!classifyCtxCache.has(supplierNit)) {
            const ctx = await loadClassifyContext({ supabase, tenantId, supplierNit }).catch(() => undefined);
            if (ctx) classifyCtxCache.set(supplierNit, ctx);
          }
          classifyCtx = classifyCtxCache.get(supplierNit);
        }
        const taxResult = calculateInvoiceTaxes(canonical, taxConfig, {
          supplier_city: canonical.datos_emisor_vendedor_municipio_ciudad.value ?? undefined,
          buyer_city: canonical.datos_adquiriente_comprador_municipio_ciudad.value ?? undefined,
          classify_context: classifyCtx,
        });

        const invoiceNumber = taxResult.invoice_number;
        const invoiceId = invoiceMap.get(invoiceNumber);

        // ── Cuenta contable sugerida (Task 19) ──────────────────────────────
        // La cuenta viene de la memoria del proveedor (classifyCtx) o de la
        // primera línea clasificada. La fuente manual (manually_confirmed) tiene
        // máxima prioridad; si no hay confirmación manual se marca "auto".
        const sm = classifyCtx?.supplier_memory;
        const firstLine = taxResult.classified_lines[0] as
          | { suggested_account_code?: string | null; memory_source?: string | null }
          | undefined;
        const suggestedAccountCode =
          sm?.default_account_code ?? firstLine?.suggested_account_code ?? null;
        const costOrExpense =
          sm?.default_cost_or_expense ?? null;
        const accountMemorySource: string | null = sm?.manually_confirmed
          ? "manual"
          : sm?.default_account_code
          ? "auto"
          : firstLine?.memory_source ?? null;

        const taxPayload: Record<string, unknown> = {
          batch_id: batchId,
          invoice_id: invoiceId ?? null,
          factura_dian_id: dian.id,
          tenant_id: tenantId,
          invoice_number: invoiceNumber,
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
          requires_review: taxResult.requires_review || canonical.detalle.length === 0,
          warnings_json: taxResult.warnings,
          result_json: taxResult,
          suggested_account_code: suggestedAccountCode,
          cost_or_expense: costOrExpense,
          account_memory_source: accountMemorySource,
        };

        const { error: upsertErr } = await supabase
          .from("invoice_tax_calculations")
          .upsert(taxPayload, { onConflict: "invoice_id,tenant_id" });

        if (upsertErr) {
          // Fallback a insert si el upsert falla por restricción diferente
          const { error: insertErr } = await supabase
            .from("invoice_tax_calculations")
            .insert(taxPayload);
          if (insertErr) {
            errors.push(`${invoiceNumber}: ${insertErr.message}`);
            continue;
          }
        }
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`factura_dian.id=${dian.id}: ${msg}`);
      }
    }

    return NextResponse.json({
      ok: true,
      batch_id: batchId,
      processed,
      skipped,
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
