/**
 * Funciones puras para validación, normalización y auditoría
 * de reclasificaciones manuales tributarias/contables.
 *
 * Sin efectos secundarios. 100% testeables sin mocks.
 */

// ─── Constantes ───────────────────────────────────────────────────────────────

export const ALLOWED_COST_OR_EXPENSE = [
  "cost",
  "expense",
  "asset",
  "liability",
  "unknown",
] as const;

export const ALLOWED_RETEICA_KIND = ["service", "purchase"] as const;

export const ALLOWED_LINE_KIND = [
  "purchase",
  "service",
  "mixed",
  "unknown",
] as const;

const KNOWN_INVOICE_FIELDS = new Set([
  "cost_or_expense",
  "account_code",
  "payable_account_code",
  "retefuente_concept",
  "reteica_city",
  "reteica_kind",
  "mark_as_reviewed",
  "reason",
]);

const KNOWN_LINE_FIELDS = new Set([
  "kind",
  "account_code",
  "retefuente_concept",
  "reteica_kind",
  "exclude_from_withholding",
  "reason",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type CostOrExpense = (typeof ALLOWED_COST_OR_EXPENSE)[number];
export type ReteicaKind = (typeof ALLOWED_RETEICA_KIND)[number];
export type LineKind = (typeof ALLOWED_LINE_KIND)[number];

export interface ValidatedInvoiceReclassification {
  cost_or_expense?: CostOrExpense;
  account_code?: string;
  payable_account_code?: string;
  retefuente_concept?: string;
  reteica_city?: string;
  reteica_kind?: ReteicaKind;
  mark_as_reviewed?: boolean;
  reason: string;
}

export interface ValidatedLineReclassification {
  kind?: LineKind;
  account_code?: string;
  retefuente_concept?: string;
  reteica_kind?: ReteicaKind;
  exclude_from_withholding?: boolean;
  reason: string;
}

export interface AuditContext {
  tenant_id: string;
  invoice_id?: string;
  factura_dian_id?: string;
  calculation_id?: string;
  line_id?: string;
  supplier_nit?: string;
  supplier_name?: string;
  reason: string;
  user_id?: string;
}

export interface ReclassificationAuditRow {
  tenant_id: string;
  invoice_id?: string;
  factura_dian_id?: string;
  calculation_id?: string;
  line_id?: string;
  supplier_nit?: string;
  supplier_name?: string;
  field_name: string;
  old_value_json: unknown;
  new_value_json: unknown;
  reason: string;
  user_id?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Valida y parsea el body de POST /invoices/:invoiceId/reclassify.
 * Lanza Error con mensaje claro si algo es inválido.
 */
export function validateInvoiceReclassificationPayload(
  payload: unknown
): ValidatedInvoiceReclassification {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Body inválido: se esperaba un objeto JSON");
  }
  const p = payload as Record<string, unknown>;

  // Reject unknown fields
  const unknownFields = Object.keys(p).filter(
    (k) => !KNOWN_INVOICE_FIELDS.has(k)
  );
  if (unknownFields.length > 0) {
    throw new Error(`Campos no permitidos: ${unknownFields.join(", ")}`);
  }

  // reason: obligatorio, mínimo 8 caracteres
  if (
    !p.reason ||
    typeof p.reason !== "string" ||
    p.reason.trim().length < 8
  ) {
    throw new Error(
      "reason es obligatorio y debe tener al menos 8 caracteres"
    );
  }

  // cost_or_expense: opcional, enum
  if (p.cost_or_expense !== undefined) {
    if (
      !(ALLOWED_COST_OR_EXPENSE as readonly string[]).includes(
        String(p.cost_or_expense)
      )
    ) {
      throw new Error(
        `cost_or_expense debe ser uno de: ${ALLOWED_COST_OR_EXPENSE.join(", ")}`
      );
    }
  }

  // account_code: si viene, no puede ser vacío
  if (p.account_code !== undefined) {
    if (
      typeof p.account_code !== "string" ||
      p.account_code.trim() === ""
    ) {
      throw new Error("account_code no puede ser vacío");
    }
  }

  // payable_account_code: si viene, no puede ser vacío
  if (p.payable_account_code !== undefined) {
    if (
      typeof p.payable_account_code !== "string" ||
      p.payable_account_code.trim() === ""
    ) {
      throw new Error("payable_account_code no puede ser vacío");
    }
  }

  // reteica_kind: opcional, enum
  if (p.reteica_kind !== undefined) {
    if (
      !(ALLOWED_RETEICA_KIND as readonly string[]).includes(
        String(p.reteica_kind)
      )
    ) {
      throw new Error(
        `reteica_kind debe ser uno de: ${ALLOWED_RETEICA_KIND.join(", ")}`
      );
    }
  }

  return {
    ...(p.cost_or_expense !== undefined && {
      cost_or_expense: p.cost_or_expense as CostOrExpense,
    }),
    ...(p.account_code !== undefined && {
      account_code: (p.account_code as string).trim(),
    }),
    ...(p.payable_account_code !== undefined && {
      payable_account_code: (p.payable_account_code as string).trim(),
    }),
    ...(p.retefuente_concept !== undefined && {
      retefuente_concept: String(p.retefuente_concept).trim(),
    }),
    ...(p.reteica_city !== undefined && {
      reteica_city: String(p.reteica_city).trim(),
    }),
    ...(p.reteica_kind !== undefined && {
      reteica_kind: p.reteica_kind as ReteicaKind,
    }),
    ...(p.mark_as_reviewed !== undefined && {
      mark_as_reviewed: Boolean(p.mark_as_reviewed),
    }),
    reason: (p.reason as string).trim(),
  };
}

/**
 * Valida y parsea el body de POST /invoices/:invoiceId/lines/:lineId/reclassify.
 * Lanza Error con mensaje claro si algo es inválido.
 */
export function validateLineReclassificationPayload(
  payload: unknown
): ValidatedLineReclassification {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Body inválido: se esperaba un objeto JSON");
  }
  const p = payload as Record<string, unknown>;

  const unknownFields = Object.keys(p).filter(
    (k) => !KNOWN_LINE_FIELDS.has(k)
  );
  if (unknownFields.length > 0) {
    throw new Error(`Campos no permitidos: ${unknownFields.join(", ")}`);
  }

  if (
    !p.reason ||
    typeof p.reason !== "string" ||
    p.reason.trim().length < 8
  ) {
    throw new Error(
      "reason es obligatorio y debe tener al menos 8 caracteres"
    );
  }

  if (p.kind !== undefined) {
    if (
      !(ALLOWED_LINE_KIND as readonly string[]).includes(String(p.kind))
    ) {
      throw new Error(
        `kind debe ser uno de: ${ALLOWED_LINE_KIND.join(", ")}`
      );
    }
  }

  if (p.account_code !== undefined) {
    if (
      typeof p.account_code !== "string" ||
      p.account_code.trim() === ""
    ) {
      throw new Error("account_code no puede ser vacío");
    }
  }

  if (p.reteica_kind !== undefined) {
    if (
      !(ALLOWED_RETEICA_KIND as readonly string[]).includes(
        String(p.reteica_kind)
      )
    ) {
      throw new Error(
        `reteica_kind debe ser uno de: ${ALLOWED_RETEICA_KIND.join(", ")}`
      );
    }
  }

  return {
    ...(p.kind !== undefined && { kind: p.kind as LineKind }),
    ...(p.account_code !== undefined && {
      account_code: (p.account_code as string).trim(),
    }),
    ...(p.retefuente_concept !== undefined && {
      retefuente_concept: String(p.retefuente_concept).trim(),
    }),
    ...(p.reteica_kind !== undefined && {
      reteica_kind: p.reteica_kind as ReteicaKind,
    }),
    ...(p.exclude_from_withholding !== undefined && {
      exclude_from_withholding: Boolean(p.exclude_from_withholding),
    }),
    reason: (p.reason as string).trim(),
  };
}

// ─── Audit rows ───────────────────────────────────────────────────────────────

/**
 * Genera una fila de auditoría por cada campo que cambió entre oldData y newData.
 * No genera fila si old === new (comparación JSON).
 */
export function buildAuditRows(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  context: AuditContext
): ReclassificationAuditRow[] {
  const rows: ReclassificationAuditRow[] = [];
  const fields = new Set([
    ...Object.keys(oldData),
    ...Object.keys(newData),
  ]);

  for (const field of fields) {
    const oldVal = oldData[field] ?? null;
    const newVal = newData[field] ?? null;

    // Sin cambio → no generar fila
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

    rows.push({
      tenant_id: context.tenant_id,
      ...(context.invoice_id !== undefined && {
        invoice_id: context.invoice_id,
      }),
      ...(context.factura_dian_id !== undefined && {
        factura_dian_id: context.factura_dian_id,
      }),
      ...(context.calculation_id !== undefined && {
        calculation_id: context.calculation_id,
      }),
      ...(context.line_id !== undefined && {
        line_id: context.line_id,
      }),
      ...(context.supplier_nit !== undefined && {
        supplier_nit: context.supplier_nit,
      }),
      ...(context.supplier_name !== undefined && {
        supplier_name: context.supplier_name,
      }),
      field_name: field,
      old_value_json: oldVal,
      new_value_json: newVal,
      reason: context.reason,
      ...(context.user_id !== undefined && { user_id: context.user_id }),
    });
  }

  return rows;
}

// ─── Confidence ───────────────────────────────────────────────────────────────

/**
 * Calcula la nueva confianza del patrón aprendido.
 * Escala desde 0.50 con incrementos de 0.05 por vez vista, cap 0.95.
 */
export function calculateUpdatedConfidence(timesSeen: number): number {
  return Math.min(0.95, 0.5 + timesSeen * 0.05);
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normaliza una descripción de ítem para usarla como clave de patrón
 * en tenant_tax_classification_memory.
 *
 * - Minúsculas
 * - Sin tildes (NFD + quitar combining marks)
 * - Sin secuencias de 6+ dígitos consecutivos (números de factura, códigos largos)
 * - Espacios repetidos colapsados
 * - Máximo 120 caracteres
 */
export function normalizeDescriptionPattern(description: string): string {
  return description
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d{6,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
