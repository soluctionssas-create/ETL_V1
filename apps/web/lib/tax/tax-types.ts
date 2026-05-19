/**
 * Tipos canónicos del motor tributario Colombia
 *
 * Motor determinístico: las reglas JSON parametrizadas son la fuente de verdad.
 * La IA solo puede sugerir clasificación; los cálculos son auditables y reproducibles.
 */

// ─── Clasificación de línea ───────────────────────────────────────────────────

export type TaxLineKind = "purchase" | "service" | "mixed" | "unknown";

export interface ClassifiedInvoiceLine {
  line_id: string;
  source_line_number: number;
  description: string;
  code?: string | null;
  quantity: number;
  unit_price: number;
  line_base: number;          // valor base (sin impuestos)
  iva_amount: number;
  iva_rate: number;
  inc_amount: number;
  inc_rate: number;
  kind: TaxLineKind;
  retefuente_concept?: string;
  retefuente_account?: string;
  reteica_city?: string;
  reteica_kind?: "service" | "purchase";
  confidence: number;         // 0..1
  reasons: string[];          // rastro auditable de la clasificación
  requires_review: boolean;
  // ── Sugerencia contable (Task 19) ─────────────────────────────────────────
  /** Cuenta PUC sugerida. null = sin evidencia suficiente → requires_review. */
  suggested_account_code?: string | null;
  suggested_account_name?: string | null;
  payable_account_code?: string | null;
  cost_or_expense?: "cost" | "expense" | "asset" | "liability" | "unknown";
  /** Fuente de la sugerencia para trazabilidad. */
  memory_source?: "manual" | "history" | "rule/ciiu" | "rule/kind" | "default";
}

// ─── Grupo de base tributaria ─────────────────────────────────────────────────

export interface TaxBaseGroup {
  tax_type: "retefuente" | "reteica" | "reteiva";
  group_key: string;            // p.ej. "retefuente:Compras:236540:0.025"
  concept: string;
  account_code: string;
  legal_reference?: string;
  base: number;                 // suma de bases de líneas del grupo
  threshold_base: number;       // base mínima para que aplique
  rate: number;                 // tarifa decimal (0.025 = 2.5%)
  calculated_amount: number;
  applies: boolean;
  reasons: string[];
  line_numbers: number[];
}

// ─── Resultado completo de cálculo tributario ─────────────────────────────────

export interface InvoiceTaxCalculationResult {
  invoice_id?: string;
  invoice_number: string;
  supplier_nit?: string;
  supplier_name?: string;
  buyer_nit?: string;
  buyer_name?: string;
  city?: string;

  subtotal: number;
  iva_total: number;
  inc_total: number;
  total_invoice: number;

  classified_lines: ClassifiedInvoiceLine[];
  groups: TaxBaseGroup[];

  totals: {
    retefuente: number;
    reteica: number;
    reteiva: number;
  };

  reported_withholdings: {
    retefuente: number;
    reteica: number;
    reteiva: number;
  };

  differences: {
    retefuente: number;    // calculated - reported
    reteica: number;
    reteiva: number;
  };

  requires_review: boolean;
  warnings: string[];
}

// ─── Reglas de parametrización ────────────────────────────────────────────────

export interface RetefuenteRule {
  concept: string;
  normativity?: string;
  base_uvt: number;
  base_cop: number;
  rate: number;
  account_code: string;
  keywords: string[];
}

export interface RetefuenteConfig {
  uvt_value_cop: number;
  default_rule: RetefuenteRule;
  rules: RetefuenteRule[];
}

export interface ReteicaCityTier {
  account_code: string;
  base_uvt: number;
  base_cop: number;
  rate: number;
  keywords?: string[];
}

export interface ReteicaCityConfig {
  service: ReteicaCityTier;
  purchase: ReteicaCityTier;
}

export interface ReteicaConfig {
  account_code: string;
  cities: Record<string, ReteicaCityConfig>;
}

export interface ReteIvaConfig {
  account_code: string;
  fallback_rate: number;
  legal_reference?: string;
  apply_when: {
    missing_or_zero_reteiva: boolean;
    iva_greater_than_zero: boolean;
  };
}

export interface TaxRulesConfig {
  retefuente: RetefuenteConfig;
  reteica: ReteicaConfig;
  reteiva: ReteIvaConfig;
}

// ─── Opciones del motor ────────────────────────────────────────────────────────

export interface TaxEngineOptions {
  /** Ciudad del tenant/empresa para ReteICA (normalizada: BOGOTA, CALI, etc.) */
  tenant_city?: string;
  /** NIT del adquiriente (comprador) */
  buyer_nit?: string;
  /** Ciudad del adquiriente (fallback si no hay tenant_city) */
  buyer_city?: string;
  /** Ciudad del emisor (fallback de último recurso) */
  supplier_city?: string;
  /**
   * Contexto de clasificación contable (Task 19).
   * Si se provee, cada línea recibirá una sugerencia de cuenta PUC.
   */
  classify_context?: import("./suggest-account").ClassifyContext;
}

// ─── Comparador de retenciones ────────────────────────────────────────────────

export type WithholdingComparisonStatus =
  | "match"
  | "difference_requires_review"
  | "not_applicable"
  | "not_reported";

export interface WithholdingComparison {
  tax_type: "retefuente" | "reteica" | "reteiva";
  reported: number;
  calculated: number;
  difference: number;
  status: WithholdingComparisonStatus;
}
