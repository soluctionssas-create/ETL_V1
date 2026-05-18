/**
 * POST /api/v1/invoices/:invoiceId/lines/:lineId/reclassify
 *
 * Reclasifica manualmente un ítem específico de una factura.
 * Modifica la línea dentro de result_json en invoice_tax_calculations,
 * registra auditoría por campo y actualiza tenant_tax_classification_memory.
 *
 * Body esperado:
 * {
 *   kind?: "purchase" | "service" | "mixed" | "unknown",
 *   account_code?: string,
 *   retefuente_concept?: string,
 *   reteica_kind?: "service" | "purchase",
 *   exclude_from_withholding?: boolean,
 *   reason: string  // obligatorio, mínimo 8 caracteres
 * }
 *
 * Seguridad:
 * - tenant_id resuelto server-side desde Bearer token o single-tenant fallback.
 * - Solo puede reclasificar líneas de facturas que pertenezcan al tenant autenticado.
 * - reason nunca se interpola en SQL crudo.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  validateLineReclassificationPayload,
  buildAuditRows,
  calculateUpdatedConfidence,
  normalizeDescriptionPattern,
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

// Tipo local para las líneas dentro de result_json
type LineEntry = {
  line_id?: string;
  source_line_number?: number;
  description?: string;
  kind?: string;
  retefuente_concept?: string;
  retefuente_account?: string;
  reteica_kind?: string;
  [key: string]: unknown;
};

const RECALC_WARNING =
  "Reclasificación manual aplicada; recalcular impuestos pendiente";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string; lineId: string }> }
) {
  try {
    const { invoiceId, lineId } = await params;
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
      payload = validateLineReclassificationPayload(body);
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
        "id, tenant_id, supplier_nit, supplier_name, invoice_number, " +
          "result_json, warnings_json"
      )
      .eq("tenant_id", tenantId)
      .eq("invoice_number", invoiceId)
      .limit(1)
      .maybeSingle();

    if (calcErr) {
      return NextResponse.json({ error: calcErr.message }, { status: 500 });
    }

    // Castear con forma fuertemente tipada para evitar GenericStringError
    type CalcRow = {
      id: string;
      tenant_id: string;
      supplier_nit: string;
      supplier_name: string;
      invoice_number: string;
      result_json: unknown;
      warnings_json: unknown;
    };
    const calc = calcData as CalcRow | null;

    const warnings: string[] = [];
    let calculationUpdated = false;
    let oldLineData: Record<string, unknown> = {};
    let lineDescription: string | undefined;

    if (calc) {
      const resultJson = (calc.result_json ?? {}) as {
        classified_lines?: LineEntry[];
        [key: string]: unknown;
      };
      const lines: LineEntry[] = resultJson.classified_lines ?? [];

      // Buscar la línea por line_id o source_line_number
      const lineIdx = lines.findIndex(
        (l) =>
          l.line_id === lineId ||
          String(l.source_line_number) === lineId
      );

      if (lineIdx === -1) {
        warnings.push(
          `Línea ${lineId} no encontrada en result_json; auditoría y memoria actualizadas sin modificar cálculos`
        );
      } else {
        const line = lines[lineIdx];
        lineDescription = line.description;

        // Capturar estado anterior para auditoría
        oldLineData = {
          kind: line.kind ?? null,
          account_code: line.retefuente_account ?? null,
          retefuente_concept: line.retefuente_concept ?? null,
          reteica_kind: line.reteica_kind ?? null,
        };

        // Aplicar cambios a la línea
        const updatedLine: LineEntry = {
          ...line,
          ...(payload.kind !== undefined && { kind: payload.kind }),
          ...(payload.account_code !== undefined && {
            retefuente_account: payload.account_code,
          }),
          ...(payload.retefuente_concept !== undefined && {
            retefuente_concept: payload.retefuente_concept,
          }),
          ...(payload.reteica_kind !== undefined && {
            reteica_kind: payload.reteica_kind,
          }),
          ...(payload.exclude_from_withholding !== undefined && {
            exclude_from_withholding: payload.exclude_from_withholding,
          }),
          manual_override: true,
        };

        const updatedLines = [...lines];
        updatedLines[lineIdx] = updatedLine;

        // Agregar warning de recálculo pendiente (idempotente)
        const existingWarnings: string[] =
          (calc.warnings_json as string[] | null) ?? [];
        const newWarnings = existingWarnings.includes(RECALC_WARNING)
          ? existingWarnings
          : [...existingWarnings, RECALC_WARNING];

        const updatedResultJson = {
          ...resultJson,
          classified_lines: updatedLines,
        };

        const { error: updateErr } = await supabase
          .from("invoice_tax_calculations")
          .update({
            result_json: updatedResultJson,
            requires_review: true,
            warnings_json: newWarnings,
            updated_at: new Date().toISOString(),
          })
          .eq("id", calc.id)
          .eq("tenant_id", tenantId); // doble filtro de seguridad

        if (updateErr) {
          return NextResponse.json(
            { error: updateErr.message },
            { status: 500 }
          );
        }
        calculationUpdated = true;
      }
    } else {
      warnings.push(
        "Factura no encontrada en cálculos tributarios; auditoría y memoria actualizadas sin modificar cálculos"
      );
    }

    // Construir nuevo estado desde payload para comparar en auditoría
    const newLineData: Record<string, unknown> = {};
    if (payload.kind !== undefined) newLineData.kind = payload.kind;
    if (payload.account_code !== undefined)
      newLineData.account_code = payload.account_code;
    if (payload.retefuente_concept !== undefined)
      newLineData.retefuente_concept = payload.retefuente_concept;
    if (payload.reteica_kind !== undefined)
      newLineData.reteica_kind = payload.reteica_kind;
    if (payload.exclude_from_withholding !== undefined)
      newLineData.exclude_from_withholding = payload.exclude_from_withholding;

    // Filas de auditoría (una por campo modificado)
    const auditRows = buildAuditRows(oldLineData, newLineData, {
      tenant_id: tenantId,
      invoice_id: calc?.id,
      calculation_id: calc?.id,
      line_id: lineId,
      supplier_nit: calc?.supplier_nit ?? undefined,
      supplier_name: calc?.supplier_name ?? undefined,
      reason: payload.reason,
      user_id: userId ?? undefined,
    });

    if (auditRows.length > 0) {
      const { error: auditErr } = await supabase
        .from("tenant_reclassification_audit")
        .insert(auditRows);
      if (auditErr) console.error("Audit insert error:", auditErr.message);
    }

    // Upsert en tenant_tax_classification_memory
    let classificationMemoryUpdated = false;
    const supplierNit = calc?.supplier_nit;
    if (supplierNit && lineDescription && Object.keys(newLineData).length > 0) {
      const pattern = normalizeDescriptionPattern(lineDescription);

      const { data: existingMem } = await supabase
        .from("tenant_tax_classification_memory")
        .select("times_seen")
        .eq("tenant_id", tenantId)
        .eq("supplier_nit", supplierNit)
        .eq("description_pattern", pattern)
        .limit(1)
        .maybeSingle();

      const currentTimesSeen =
        (existingMem as { times_seen?: number } | null)?.times_seen ?? 0;
      const newTimesSeen = currentTimesSeen + 1;

      const { error: classMemErr } = await supabase
        .from("tenant_tax_classification_memory")
        .upsert(
          {
            tenant_id: tenantId,
            supplier_nit: supplierNit,
            description_pattern: pattern,
            ...(payload.kind !== undefined && { kind: payload.kind }),
            ...(payload.account_code !== undefined && {
              account_code: payload.account_code,
            }),
            ...(payload.retefuente_concept !== undefined && {
              retefuente_concept: payload.retefuente_concept,
            }),
            ...(payload.reteica_kind !== undefined && {
              reteica_kind: payload.reteica_kind,
            }),
            times_seen: newTimesSeen,
            confidence: calculateUpdatedConfidence(newTimesSeen),
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,supplier_nit,description_pattern" }
        );
      if (classMemErr)
        console.error(
          "Classification memory upsert error:",
          classMemErr.message
        );
      else classificationMemoryUpdated = true;
    }

    return NextResponse.json({
      ok: true,
      invoice_id: invoiceId,
      line_id: lineId,
      calculation_updated: calculationUpdated,
      classification_memory_updated: classificationMemoryUpdated,
      audit_rows_created: auditRows.length,
      ...(warnings.length > 0 && { warnings }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
