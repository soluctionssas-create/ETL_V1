/**
 * POST /api/v1/invoices/:invoiceId/reprocess
 *
 * Re-ejecuta el motor tributario sobre una factura existente en facturas_dian.
 * Útil para recalcular facturas que se procesaron antes del fix del extractor PDF
 * o cuando la configuración de reglas tributarias cambió.
 *
 * :invoiceId  = invoice_number (string, ej. "F11-10191"), NO uuid.
 *
 * Seguridad:
 * - tenant_id resuelto server-side desde Bearer token o single-tenant fallback.
 * - Solo procesa facturas que pertenezcan al tenant autenticado.
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
): Promise<{ tenantId: string | null; userId: string | null }> {
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
      if (r?.tenant_id) return { tenantId: r.tenant_id, userId: user.id };
    }
  }
  // Fallback single-tenant
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const t = tenant as { id?: string } | null;
  return { tenantId: t?.id ?? null, userId: null };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const supabase = supabaseAdmin();
    const { tenantId } = await resolveSession(req, supabase);

    if (!tenantId) {
      return NextResponse.json({ error: "Tenant no identificado" }, { status: 401 });
    }

    // Buscar la factura DIAN por invoice_number (relación invoice → facturas_dian)
    const { data: invoiceRow, error: invErr } = await supabase
      .from("invoices")
      .select("id, batch_id")
      .eq("invoice_number", invoiceId)
      .eq("tenant_id", tenantId)
      .single();

    if (invErr || !invoiceRow) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }

    const invRow = invoiceRow as { id: string; batch_id: string };

    // Obtener el canonical_invoice_json desde facturas_dian
    const { data: dianRow, error: dianErr } = await supabase
      .from("facturas_dian")
      .select("id, canonical_invoice_json, extraction_warnings_json")
      .eq("batch_id", invRow.batch_id)
      .maybeSingle();

    if (dianErr || !dianRow) {
      return NextResponse.json({ error: "Datos DIAN no encontrados para esta factura" }, { status: 404 });
    }

    const dian = dianRow as {
      id: string;
      canonical_invoice_json: DianCanonicalInvoice | null;
      extraction_warnings_json: string[] | null;
    };

    if (!dian.canonical_invoice_json) {
      return NextResponse.json(
        { error: "Sin canonical_invoice_json — la factura debe ser reprocesada manualmente" },
        { status: 422 }
      );
    }

    const canonical = dian.canonical_invoice_json;

    // Re-ejecutar motor tributario
    const taxConfig = getDefaultTaxRulesConfig();
    // ── Contexto contable por proveedor (Task 19.1) ──────────────────────────
    const classifyCtx = await loadClassifyContext({
      supabase,
      tenantId,
      supplierNit: canonical.datos_emisor_vendedor_nit_emisor.value ?? null,
    }).catch(() => undefined);
    const taxResult = calculateInvoiceTaxes(canonical, taxConfig, {
      supplier_city: canonical.datos_emisor_vendedor_municipio_ciudad.value ?? undefined,
      buyer_city: canonical.datos_adquiriente_comprador_municipio_ciudad.value ?? undefined,
      classify_context: classifyCtx,
    });

    const hasNoDetail = canonical.detalle.length === 0;

    const taxPayload: Record<string, unknown> = {
      batch_id: invRow.batch_id,
      invoice_id: invRow.id,
      factura_dian_id: dian.id,
      tenant_id: tenantId,
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
      requires_review: taxResult.requires_review || hasNoDetail,
      warnings_json: taxResult.warnings,
      result_json: taxResult,
    };

    // Upsert (insertar o actualizar si ya existía)
    const { data: upserted, error: upsertErr } = await supabase
      .from("invoice_tax_calculations")
      .upsert(taxPayload, { onConflict: "invoice_id,tenant_id" })
      .select("id")
      .single();

    if (upsertErr) {
      // Si el upsert falla (ej: no hay constraint unique), intentar insert
      const { data: inserted, error: insertErr } = await supabase
        .from("invoice_tax_calculations")
        .insert(taxPayload)
        .select("id")
        .single();
      if (insertErr) {
        return NextResponse.json(
          { error: `Error al guardar cálculo tributario: ${insertErr.message}` },
          { status: 500 }
        );
      }
      return NextResponse.json({
        ok: true,
        invoice_id: invRow.id,
        calculation_id: (inserted as { id: string } | null)?.id,
        invoice_number: taxResult.invoice_number,
        detail_lines: canonical.detalle.length,
        requires_review: taxResult.requires_review || hasNoDetail,
        warnings: taxResult.warnings,
        action: "inserted",
      });
    }

    return NextResponse.json({
      ok: true,
      invoice_id: invRow.id,
      calculation_id: (upserted as { id: string } | null)?.id,
      invoice_number: taxResult.invoice_number,
      detail_lines: canonical.detalle.length,
      requires_review: taxResult.requires_review || hasNoDetail,
      warnings: taxResult.warnings,
      action: "upserted",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
