/**
 * POST /api/v1/invoices/:invoiceId/reclassify
 *
 * Reclasifica manualmente la clasificación tributaria/contable de una factura.
 * Actualiza la memoria del proveedor en tenant_supplier_memory y registra
 * una fila de auditoría por cada campo modificado.
 *
 * Body esperado:
 * {
 *   cost_or_expense?: "cost" | "expense" | "asset" | "liability" | "unknown",
 *   account_code?: string,
 *   payable_account_code?: string,
 *   retefuente_concept?: string,
 *   reteica_city?: string,
 *   reteica_kind?: "service" | "purchase",
 *   mark_as_reviewed?: boolean,
 *   reason: string  // obligatorio, mínimo 8 caracteres
 * }
 *
 * Seguridad:
 * - tenant_id resuelto server-side desde Bearer token o single-tenant fallback.
 * - Solo puede reclasificar facturas que pertenezcan al tenant autenticado.
 * - reason nunca se interpola en SQL crudo.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  validateInvoiceReclassificationPayload,
  buildAuditRows,
  calculateUpdatedConfidence,
} from "@/lib/tax/reclassification";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key);
}

/** Resuelve tenant_id y user_id desde el Bearer token; fallback a single-tenant. */
async function resolveSession(
  req: NextRequest,
  supabase: ReturnType<typeof supabaseAdmin>
): Promise<{ tenantId: string | null; userId: string | null }> {
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
      if (r?.tenant_id) return { tenantId: r.tenant_id, userId: user.id };
    }
  }
  // Single-tenant fallback
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return {
    tenantId: (tenant as { id?: string } | null)?.id ?? null,
    userId: null,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const supabase = supabaseAdmin();

    const { tenantId, userId } = await resolveSession(req, supabase);
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant no identificado" },
        { status: 401 }
      );
    }

    // Parse + validate body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
    }

    let payload;
    try {
      payload = validateInvoiceReclassificationPayload(body);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }

    // Buscar cálculo de la factura — filtrar por tenant_id (aislamiento)
    const { data: calcData, error: calcErr } = await supabase
      .from("invoice_tax_calculations")
      .select(
        "id, tenant_id, supplier_nit, supplier_name, invoice_number, requires_review"
      )
      .eq("tenant_id", tenantId)
      .eq("invoice_number", invoiceId)
      .limit(1)
      .maybeSingle();

    if (calcErr) {
      return NextResponse.json({ error: calcErr.message }, { status: 500 });
    }

    const warnings: string[] = [];

    // Leer estado actual de la memoria del proveedor para comparar en auditoría
    let oldMemory: Record<string, unknown> = {};
    if (calcData?.supplier_nit) {
      const { data: memData } = await supabase
        .from("tenant_supplier_memory")
        .select(
          "default_cost_or_expense, default_account_code, default_payable_account, " +
            "default_retefuente_concept, default_reteica_city, default_reteica_kind, " +
            "times_seen, confidence"
        )
        .eq("tenant_id", tenantId)
        .eq("supplier_nit", calcData.supplier_nit)
        .maybeSingle();
      if (memData) oldMemory = memData as unknown as Record<string, unknown>;
    }

    // Construir nuevo estado desde el payload (solo campos enviados)
    const newMemory: Record<string, unknown> = {};
    if (payload.cost_or_expense !== undefined)
      newMemory.default_cost_or_expense = payload.cost_or_expense;
    if (payload.account_code !== undefined)
      newMemory.default_account_code = payload.account_code;
    if (payload.payable_account_code !== undefined)
      newMemory.default_payable_account = payload.payable_account_code;
    if (payload.retefuente_concept !== undefined)
      newMemory.default_retefuente_concept = payload.retefuente_concept;
    if (payload.reteica_city !== undefined)
      newMemory.default_reteica_city = payload.reteica_city;
    if (payload.reteica_kind !== undefined)
      newMemory.default_reteica_kind = payload.reteica_kind;

    // Actualizar result_json con la clasificación manual y controlar requires_review
    let calculationUpdated = false;
    if (calcData) {
      const manualClassification: Record<string, unknown> = {
        ...newMemory,
        applied_at: new Date().toISOString(),
        reason: payload.reason,
      };

      const nextRequiresReview =
        payload.mark_as_reviewed === true
          ? false
          : (calcData.requires_review as boolean | undefined) ?? false;

      const { error: updateErr } = await supabase
        .from("invoice_tax_calculations")
        .update({
          result_json: {
            manual_classification: manualClassification,
          },
          requires_review: nextRequiresReview,
          updated_at: new Date().toISOString(),
        })
        .eq("id", calcData.id)
        .eq("tenant_id", tenantId); // doble filtro de seguridad

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
      calculationUpdated = true;
    } else {
      warnings.push(
        "Factura no encontrada en cálculos tributarios; auditoría y memoria actualizadas sin modificar cálculos"
      );
    }

    // Construir y persistir filas de auditoría (una por campo modificado)
    const auditRows = buildAuditRows(oldMemory, newMemory, {
      tenant_id: tenantId,
      invoice_id: calcData?.id,
      calculation_id: calcData?.id,
      supplier_nit: calcData?.supplier_nit ?? undefined,
      supplier_name: calcData?.supplier_name ?? undefined,
      reason: payload.reason,
      user_id: userId ?? undefined,
    });

    if (auditRows.length > 0) {
      const { error: auditErr } = await supabase
        .from("tenant_reclassification_audit")
        .insert(auditRows);
      if (auditErr) console.error("Audit insert error:", auditErr.message);
    }

    // Upsert en tenant_supplier_memory
    let memoryUpdated = false;
    const supplierNit = calcData?.supplier_nit;
    if (supplierNit && Object.keys(newMemory).length > 0) {
      const currentTimesSeen =
        (oldMemory.times_seen as number | undefined) ?? 0;
      const newTimesSeen = currentTimesSeen + 1;
      const newConfidence = calculateUpdatedConfidence(newTimesSeen);

      const { error: memErr } = await supabase
        .from("tenant_supplier_memory")
        .upsert(
          {
            tenant_id: tenantId,
            supplier_nit: supplierNit,
            supplier_name: calcData?.supplier_name ?? null,
            ...newMemory,
            times_seen: newTimesSeen,
            confidence: newConfidence,
            last_seen_at: new Date().toISOString(),
            manually_confirmed: true,
            confirmed_at: new Date().toISOString(),
            source: "manual_reclassification",
          },
          { onConflict: "tenant_id,supplier_nit" }
        );
      if (memErr) console.error("Memory upsert error:", memErr.message);
      else memoryUpdated = true;
    }

    return NextResponse.json({
      ok: true,
      invoice_id: invoiceId,
      calculation_updated: calculationUpdated,
      memory_updated: memoryUpdated,
      audit_rows_created: auditRows.length,
      ...(warnings.length > 0 && { warnings }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
