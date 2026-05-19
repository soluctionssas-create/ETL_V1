/**
 * Motor de sugerencia contable granular — Task 19
 *
 * Sugiere cuenta contable PUC Colombia por línea de factura usando una
 * cadena de prioridad auditada:
 *   1. Memoria manual del tenant por proveedor (tenant_supplier_memory)
 *   2. Memoria por patrón de descripción (tenant_tax_classification_memory)
 *   3. Patrones históricos importados (tenant_accounting_patterns)
 *   4. Reglas por actividad económica CIIU
 *   5. Reglas por kind (purchase / service)
 *   6. Fallback seguro: null + requires_review=true
 *
 * NUNCA se asigna 513595 u otra cuenta hardcodeada como fallback universal.
 * Si no hay evidencia suficiente → account_code = null.
 *
 * Este módulo es 100% puro (sin DB, sin side-effects).
 * La consulta a BD ocurre en la capa de API/procesamiento que provee el contexto.
 */

import type { TaxLineKind } from "./tax-types";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Cuenta del PUC colombiano. */
export interface PucAccount {
  code: string;
  name: string;
}

/** Memoria de proveedor leída desde tenant_supplier_memory. */
export interface SupplierMemory {
  default_account_code?: string | null;
  default_payable_account?: string | null;
  default_cost_or_expense?: string | null;
  default_retefuente_concept?: string | null;
  default_reteica_city?: string | null;
  default_reteica_kind?: string | null;
  confidence?: number | null;
  manually_confirmed?: boolean | null;
}

/** Memoria de descripción leída desde tenant_tax_classification_memory. */
export interface LineMemory {
  account_code?: string | null;
  kind?: string | null;
  retefuente_concept?: string | null;
  confidence?: number | null;
}

/** Patrón contable histórico leído desde tenant_accounting_patterns. */
export interface AccountingPattern {
  account_code: string;
  account_description?: string | null;
  payable_account_code?: string | null;
  cost_or_expense?: string | null;
  line_kind?: string | null;
  confidence?: number | null;
  usage_count?: number | null;
}

/** Contexto completo del tenant disponible en el momento de clasificar. */
export interface ClassifyContext {
  supplier_nit?: string | null;
  supplier_ciiu?: string | null;           // código CIIU del emisor (ej: "5611")
  supplier_memory?: SupplierMemory | null; // desde tenant_supplier_memory
  line_memory?: LineMemory | null;         // desde tenant_tax_classification_memory
  accounting_patterns?: AccountingPattern[]; // desde tenant_accounting_patterns
}

/** Fuente de la sugerencia — de mayor a menor confiabilidad. */
export type MemorySource =
  | "manual"       // confirmado manualmente por el usuario del tenant
  | "history"      // patrón de movimientos históricos importados
  | "rule/ciiu"    // regla por actividad económica CIIU
  | "rule/kind"    // regla por tipo de línea (purchase/service)
  | "default";     // sin regla aplicable

export type CostOrExpense = "cost" | "expense" | "asset" | "liability" | "unknown";

/** Resultado de la sugerencia contable por línea. */
export interface AccountSuggestion {
  account_code: string | null;   // null = se desconoce, requiere revisión
  account_name: string | null;
  payable_account_code: string | null;
  cost_or_expense: CostOrExpense;
  memory_source: MemorySource;
  confidence: number;            // 0..1
  reasons: string[];
}

// ─── Catálogo de cuentas PUC Colombia (subset relevante) ─────────────────────

/** Subset del PUC 2650/Decreto 2649 usado por las reglas del motor. */
export const PUC_ACCOUNTS: Record<string, string> = {
  // Costos de ventas
  "6135":   "Costo de ventas - Comercio",
  "613502": "Costo de ventas de mercancías",
  // Costos de producción
  "7205":   "Materias primas",
  "720502": "Materias primas para producción",
  // Gastos operacionales de administración
  "5120":   "Arrendamientos",
  "5125":   "Contribuciones y afiliaciones",
  "5130":   "Seguros",
  "5135":   "Servicios",
  "513502": "Servicios de aseo y vigilancia",
  "5145":   "Mantenimiento y reparaciones",
  "5155":   "Gastos de viaje",
  "5195":   "Gastos varios",
  "519501": "Gastos generales",
  // Gastos no operacionales
  "5310":   "Financieros",
  // Pasivos
  "2205":   "Cuentas por pagar - Proveedores",
  "220501": "Proveedores nacionales",
  "2335":   "Costos y gastos por pagar",
  // Retenciones
  "2365":   "Retención en la fuente",
  "2368":   "Impuesto a las ventas retenido (ReteIVA)",
  "2370":   "Retención de ICA",
};

// ─── Reglas por actividad económica CIIU ─────────────────────────────────────

interface CiiuRule {
  /** Prefijo CIIU (ej: "56" para restaurantes y hoteles 5600-5699) */
  prefix: string;
  description: string;
  purchase: { account_code: string; cost_or_expense: CostOrExpense };
  service: { account_code: string; cost_or_expense: CostOrExpense };
  payable_account_code: string;
}

/**
 * Reglas contables por familia CIIU.
 * Cubren los sectores más frecuentes en Colombia.
 * Las cuentas sin certeza absoluta NO están incluidas.
 */
export const CIIU_RULES: CiiuRule[] = [
  // Restaurantes y establecimientos de bebida (5610-5619)
  {
    prefix: "56",
    description: "Restaurantes y alojamiento",
    purchase: { account_code: "7205", cost_or_expense: "cost" },
    service: { account_code: "5195", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Comercio al por menor (4710-4799)
  {
    prefix: "47",
    description: "Comercio al por menor",
    purchase: { account_code: "6135", cost_or_expense: "cost" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Comercio al por mayor (4610-4690)
  {
    prefix: "46",
    description: "Comercio al por mayor",
    purchase: { account_code: "6135", cost_or_expense: "cost" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Actividades informáticas y de sistemas (6200-6299)
  {
    prefix: "62",
    description: "Tecnología de información",
    purchase: { account_code: "5195", cost_or_expense: "expense" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Construcción (4100-4399)
  {
    prefix: "41",
    description: "Construcción de edificios",
    purchase: { account_code: "7205", cost_or_expense: "cost" },
    service: { account_code: "5145", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  {
    prefix: "42",
    description: "Construcción de obras civiles",
    purchase: { account_code: "7205", cost_or_expense: "cost" },
    service: { account_code: "5145", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  {
    prefix: "43",
    description: "Actividades especializadas de construcción",
    purchase: { account_code: "7205", cost_or_expense: "cost" },
    service: { account_code: "5145", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Transporte (4900-5299)
  {
    prefix: "49",
    description: "Transporte terrestre",
    purchase: { account_code: "6135", cost_or_expense: "cost" },
    service: { account_code: "5155", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Actividades profesionales y científicas (6900-7599)
  {
    prefix: "69",
    description: "Actividades jurídicas y contables",
    purchase: { account_code: "5195", cost_or_expense: "expense" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  {
    prefix: "70",
    description: "Actividades de administración empresarial",
    purchase: { account_code: "5195", cost_or_expense: "expense" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  {
    prefix: "71",
    description: "Ingeniería y consultoría",
    purchase: { account_code: "5195", cost_or_expense: "expense" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  {
    prefix: "74",
    description: "Publicidad y marketing",
    purchase: { account_code: "5195", cost_or_expense: "expense" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Manufactura — alimentos y bebidas (1010-1099)
  {
    prefix: "10",
    description: "Elaboración de productos alimenticios",
    purchase: { account_code: "7205", cost_or_expense: "cost" },
    service: { account_code: "5195", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Manufactura general (1000-3399)
  {
    prefix: "15",
    description: "Fabricación de otros productos",
    purchase: { account_code: "7205", cost_or_expense: "cost" },
    service: { account_code: "5145", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  {
    prefix: "20",
    description: "Fabricación de productos químicos",
    purchase: { account_code: "7205", cost_or_expense: "cost" },
    service: { account_code: "5145", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Educación (8500-8599)
  {
    prefix: "85",
    description: "Educación",
    purchase: { account_code: "5195", cost_or_expense: "expense" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
  // Salud (8610-8699)
  {
    prefix: "86",
    description: "Actividades de salud",
    purchase: { account_code: "5195", cost_or_expense: "expense" },
    service: { account_code: "5135", cost_or_expense: "expense" },
    payable_account_code: "220501",
  },
];

// ─── Helpers internos ─────────────────────────────────────────────────────────

function normalizeCiiu(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Tomar solo los 4 primeros dígitos del código CIIU (ej: "5611-01" → "5611")
  const match = raw.match(/^(\d{4})/);
  return match ? match[1] : null;
}

function findCiiuRule(ciiu: string | null | undefined): CiiuRule | null {
  if (!ciiu) return null;
  const normalized = normalizeCiiu(ciiu);
  if (!normalized) return null;
  for (const rule of CIIU_RULES) {
    if (normalized.startsWith(rule.prefix)) return rule;
  }
  return null;
}

function accountName(code: string | null | undefined): string | null {
  if (!code) return null;
  // Búsqueda exacta primero, luego por prefijo (3 primeros dígitos)
  return PUC_ACCOUNTS[code] ?? PUC_ACCOUNTS[code.slice(0, 4)] ?? null;
}

function normalizeCostOrExpense(raw: string | null | undefined): CostOrExpense {
  const allowed: CostOrExpense[] = ["cost", "expense", "asset", "liability", "unknown"];
  if (raw && allowed.includes(raw as CostOrExpense)) return raw as CostOrExpense;
  return "unknown";
}

// ─── Motor principal ─────────────────────────────────────────────────────────

/**
 * Sugiere una cuenta contable PUC para una línea clasificada.
 *
 * La función es completamente pura — recibe todo el contexto como parámetros.
 * La carga de datos desde BD es responsabilidad del caller (API route).
 *
 * @param kind  - Clasificación de la línea (purchase/service/mixed/unknown)
 * @param context - Contexto del tenant con memorias y patrones
 */
export function suggestAccountForLine(
  kind: TaxLineKind,
  context: ClassifyContext = {}
): AccountSuggestion {
  const reasons: string[] = [];

  // ── Prioridad 1: memoria manual del proveedor (confirmada por el usuario) ──
  const sm = context.supplier_memory;
  if (sm?.default_account_code && sm.manually_confirmed) {
    const code = sm.default_account_code;
    reasons.push(
      `Cuenta confirmada manualmente para el proveedor ${context.supplier_nit ?? "—"}: ${code}`
    );
    return {
      account_code: code,
      account_name: accountName(code),
      payable_account_code: sm.default_payable_account ?? "220501",
      cost_or_expense: normalizeCostOrExpense(sm.default_cost_or_expense),
      memory_source: "manual",
      confidence: Math.min(1, (sm.confidence ?? 0.9)),
      reasons,
    };
  }

  // ── Prioridad 2: memoria manual no confirmada (alta confianza aún) ────────
  if (sm?.default_account_code && (sm.confidence ?? 0) >= 0.7) {
    const code = sm.default_account_code;
    reasons.push(
      `Cuenta de memoria del proveedor (confianza ${sm.confidence?.toFixed(2) ?? "n/a"}): ${code}`
    );
    return {
      account_code: code,
      account_name: accountName(code),
      payable_account_code: sm.default_payable_account ?? "220501",
      cost_or_expense: normalizeCostOrExpense(sm.default_cost_or_expense),
      memory_source: "manual",
      confidence: sm.confidence ?? 0.7,
      reasons,
    };
  }

  // ── Prioridad 3: memoria por patrón de descripción de línea ──────────────
  const lm = context.line_memory;
  if (lm?.account_code && (lm.confidence ?? 0) >= 0.6) {
    const code = lm.account_code;
    reasons.push(
      `Cuenta de memoria por patrón de descripción (confianza ${lm.confidence?.toFixed(2) ?? "n/a"}): ${code}`
    );
    return {
      account_code: code,
      account_name: accountName(code),
      payable_account_code: sm?.default_payable_account ?? "220501",
      cost_or_expense: normalizeCostOrExpense(sm?.default_cost_or_expense),
      memory_source: "history",
      confidence: lm.confidence ?? 0.6,
      reasons,
    };
  }

  // ── Prioridad 4: patrones históricos contables del proveedor ──────────────
  const patterns = context.accounting_patterns ?? [];
  if (patterns.length > 0) {
    // Buscar el patrón de mayor uso del mismo kind
    const kindPatterns = patterns
      .filter((p) => !p.line_kind || p.line_kind === kind || p.line_kind === "mixed")
      .sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0));
    const best = kindPatterns[0];
    if (best && (best.confidence ?? 0) >= 0.5) {
      const code = best.account_code;
      reasons.push(
        `Patrón histórico importado (${best.usage_count ?? 1} uso(s), confianza ${best.confidence?.toFixed(2) ?? "n/a"}): ${code}`
      );
      return {
        account_code: code,
        account_name: best.account_description ?? accountName(code),
        payable_account_code: best.payable_account_code ?? "220501",
        cost_or_expense: normalizeCostOrExpense(best.cost_or_expense),
        memory_source: "history",
        confidence: best.confidence ?? 0.5,
        reasons,
      };
    }
  }

  // ── Prioridad 5: regla por actividad económica CIIU ───────────────────────
  const ciiuRule = findCiiuRule(context.supplier_ciiu);
  if (ciiuRule) {
    if (kind === "purchase") {
      const code = ciiuRule.purchase.account_code;
      reasons.push(
        `Regla CIIU ${context.supplier_ciiu} (${ciiuRule.description}) → purchase → ${code}`
      );
      return {
        account_code: code,
        account_name: accountName(code),
        payable_account_code: ciiuRule.payable_account_code,
        cost_or_expense: ciiuRule.purchase.cost_or_expense,
        memory_source: "rule/ciiu",
        confidence: 0.55,
        reasons,
      };
    }
    if (kind === "service") {
      const code = ciiuRule.service.account_code;
      reasons.push(
        `Regla CIIU ${context.supplier_ciiu} (${ciiuRule.description}) → service → ${code}`
      );
      return {
        account_code: code,
        account_name: accountName(code),
        payable_account_code: ciiuRule.payable_account_code,
        cost_or_expense: ciiuRule.service.cost_or_expense,
        memory_source: "rule/ciiu",
        confidence: 0.55,
        reasons,
      };
    }
    if (kind === "mixed") {
      // Usar la cuenta de mayor riesgo (servicio) para no subestimar retenciones
      const code = ciiuRule.service.account_code;
      reasons.push(
        `Regla CIIU ${context.supplier_ciiu} (${ciiuRule.description}) → mixed → usando regla service: ${code} (requiere revisión)`
      );
      return {
        account_code: code,
        account_name: accountName(code),
        payable_account_code: ciiuRule.payable_account_code,
        cost_or_expense: ciiuRule.service.cost_or_expense,
        memory_source: "rule/ciiu",
        confidence: 0.4,
        reasons,
      };
    }
  }

  // ── Prioridad 6: regla por kind (sin CIIU) ────────────────────────────────
  if (kind === "purchase") {
    reasons.push("Sin CIIU ni memoria — compra/bien genérico. Cuenta no inferida. Requiere revisión.");
    return {
      account_code: null,
      account_name: null,
      payable_account_code: "220501",
      cost_or_expense: "cost",
      memory_source: "rule/kind",
      confidence: 0.2,
      reasons,
    };
  }
  if (kind === "service") {
    reasons.push("Sin CIIU ni memoria — servicio genérico. Cuenta no inferida. Requiere revisión.");
    return {
      account_code: null,
      account_name: null,
      payable_account_code: "220501",
      cost_or_expense: "expense",
      memory_source: "rule/kind",
      confidence: 0.2,
      reasons,
    };
  }

  // ── Fallback seguro — no hay información suficiente ───────────────────────
  reasons.push("Sin keywords, sin CIIU, sin memoria — clasificación desconocida. Requiere revisión manual.");
  return {
    account_code: null,
    account_name: null,
    payable_account_code: "220501",
    cost_or_expense: "unknown",
    memory_source: "default",
    confidence: 0,
    reasons,
  };
}

/**
 * Enriquece un array de líneas clasificadas con sugerencias contables.
 * Cada línea recibe la sugerencia basada en el mismo contexto.
 */
export function enrichLinesWithAccountSuggestions<
  T extends { kind: TaxLineKind; reasons: string[]; confidence: number }
>(
  lines: T[],
  context: ClassifyContext = {}
): (T & {
  suggested_account_code: string | null;
  suggested_account_name: string | null;
  payable_account_code: string | null;
  cost_or_expense: CostOrExpense;
  memory_source: MemorySource;
})[] {
  return lines.map((line) => {
    const suggestion = suggestAccountForLine(line.kind, context);
    return {
      ...line,
      suggested_account_code: suggestion.account_code,
      suggested_account_name: suggestion.account_name,
      payable_account_code: suggestion.payable_account_code,
      cost_or_expense: suggestion.cost_or_expense,
      memory_source: suggestion.memory_source,
      confidence: Math.max(line.confidence, suggestion.confidence),
      reasons: [...line.reasons, ...suggestion.reasons],
    };
  });
}
