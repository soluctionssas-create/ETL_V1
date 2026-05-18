import type { TaxCalculation, ManualClassification } from "../api";

// ── EditDraft ─────────────────────────────────────────────────────────────────

export interface EditDraft {
  cost_or_expense: "cost" | "expense" | "asset" | "liability" | "unknown";
  account_code: string;
  payable_account_code: string;
  retefuente_concept: string;
  reteica_city: string;
  reteica_kind: "service" | "purchase";
  mark_as_reviewed: boolean;
  reason: string;
  save_to_memory: boolean;
}

export const defaultDraft: EditDraft = {
  cost_or_expense: "expense",
  account_code: "",
  payable_account_code: "220500",
  retefuente_concept: "",
  reteica_city: "",
  reteica_kind: "service",
  mark_as_reviewed: false,
  reason: "",
  save_to_memory: true,
};

// ── helpers ───────────────────────────────────────────────────────────────────

/** Determina el estado visual de una fila de cálculo tributario. */
export function rowStatus(c: TaxCalculation): "ok" | "warning" | "error" {
  const rf = Math.abs(c.retefuente_difference ?? 0);
  const ri = Math.abs(c.reteica_difference ?? 0);
  const rv = Math.abs(c.reteiva_difference ?? 0);
  if (rf > 1 || ri > 1 || rv > 1) return "error";
  if (c.requires_review) return "warning";
  return "ok";
}

/**
 * Determina la cuenta contable a mostrar en la columna IA.
 * Prioridad: manual_classification.account_code → kind dominante → "–"
 * Nunca devuelve un valor hardcodeado como 513595.
 */
export function accountDisplay(c: TaxCalculation): string {
  const mc = c.result_json?.manual_classification;
  if (mc?.account_code) return mc.account_code;
  const lines = c.result_json?.classified_lines;
  if (!lines?.length) return "–";
  const counts: Record<string, number> = {};
  for (const l of lines) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
  const dominant =
    (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as string) ?? "unknown";
  if (dominant === "service") return "Servicio";
  if (dominant === "purchase") return "Compra";
  return "–";
}

/** Construye el draft inicial para el drawer de edición desde un cálculo. */
export function draftFromCalc(c: TaxCalculation): EditDraft {
  const mc = c.result_json?.manual_classification as ManualClassification | undefined;
  const lines = c.result_json?.classified_lines ?? [];
  const city = lines.find((l) => l.reteica_city)?.reteica_city ?? "";
  const concept = lines.find((l) => l.retefuente_concept)?.retefuente_concept ?? "";
  return {
    cost_or_expense: (mc?.cost_or_expense as EditDraft["cost_or_expense"]) ?? "expense",
    account_code: mc?.account_code ?? "",
    payable_account_code: mc?.payable_account_code ?? "220500",
    retefuente_concept: (mc?.retefuente_concept ?? concept) as string,
    reteica_city: (mc?.reteica_city ?? city) as string,
    reteica_kind: (mc?.reteica_kind as "service" | "purchase") ?? "service",
    mark_as_reviewed: !c.requires_review,
    reason: "",
    save_to_memory: true,
  };
}

/** Formatea un número como moneda COP. */
export function fmtCOP(v: number | null | undefined): string {
  if (v == null) return "–";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(v);
}
