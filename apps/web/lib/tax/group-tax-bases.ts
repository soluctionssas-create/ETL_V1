/**
 * Agrupador de bases tributarias
 *
 * Toma las líneas clasificadas y genera grupos de bases para:
 *   - ReteFuente: por concepto + cuenta + tarifa
 *   - ReteICA:    por ciudad + tipo (service|purchase) + cuenta + tarifa
 *   - ReteIVA:    único grupo (base = iva_total)
 */

import type {
  ClassifiedInvoiceLine,
  TaxBaseGroup,
  RetefuenteConfig,
  ReteicaConfig,
  ReteIvaConfig,
} from "./tax-types";

// ─── Agrupación ReteFuente ─────────────────────────────────────────────────────

/**
 * Genera grupos ReteFuente agrupando líneas por concepto+cuenta+tarifa.
 * La base de cada línea es `line_base` (NO incluye IVA ni INC).
 */
export function groupRetefuenteBases(
  lines: ClassifiedInvoiceLine[],
  config: RetefuenteConfig
): TaxBaseGroup[] {
  const map = new Map<string, TaxBaseGroup>();

  for (const line of lines) {
    const concept = line.retefuente_concept ?? config.default_rule.concept;
    const account = line.retefuente_account ?? config.default_rule.account_code;

    // Buscar la tarifa correspondiente al concepto
    const rule =
      config.rules.find((r) => r.concept === concept) ?? config.default_rule;

    const key = `retefuente:${concept}:${account}:${rule.rate}`;

    if (!map.has(key)) {
      map.set(key, {
        tax_type: "retefuente",
        group_key: key,
        concept,
        account_code: account,
        legal_reference: rule.normativity,
        base: 0,
        threshold_base: rule.base_cop,
        rate: rule.rate,
        calculated_amount: 0,
        applies: false,
        reasons: [],
        line_numbers: [],
      });
    }

    const group = map.get(key)!;
    group.base += line.line_base;
    group.line_numbers.push(line.source_line_number);
  }

  return Array.from(map.values());
}

// ─── Agrupación ReteICA ────────────────────────────────────────────────────────

/**
 * Determina ciudad normalizada para ReteICA.
 * Prioridad: tenant_city > buyer_city > supplier_city.
 * Normalización: "Bogotá, D.C." → "BOGOTA", "Cali" → "CALI".
 */
export function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/,\s*D\.C\./gi, "")
    .replace(/\bDISTRITO\b.*/i, "")
    .replace(/[^A-Z\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");

  // Aliases conocidos
  if (s.includes("BOGOT")) return "BOGOTA";
  if (s.includes("CALI") || s.includes("SANTIAGO_DE_CALI")) return "CALI";
  if (s.includes("MEDELLIN") || s.includes("MEDELL")) return "MEDELLIN";
  if (s.includes("BARRANQUILLA")) return "BARRANQUILLA";
  if (s.includes("CARTAGENA")) return "CARTAGENA";
  if (s.includes("CUCUTA") || s.includes("CUCUTA")) return "CUCUTA";
  if (s.includes("BUCARAMANGA")) return "BUCARAMANGA";
  if (s.includes("PEREIRA")) return "PEREIRA";
  if (s.includes("MANIZALES")) return "MANIZALES";
  if (s.includes("IBAGUE")) return "IBAGUE";

  return s || null;
}

/**
 * Genera grupos ReteICA agrupando líneas por ciudad + tipo.
 * Líneas `unknown` o `mixed` se agrupan como `purchase` con flag requires_review.
 */
export function groupReteicaBases(
  lines: ClassifiedInvoiceLine[],
  config: ReteicaConfig,
  resolvedCity: string | null,
  options: { addReviewFlag?: boolean } = {}
): TaxBaseGroup[] {
  if (!resolvedCity) {
    // Sin ciudad: crear un grupo de revisión con toda la base
    const totalBase = lines.reduce((s, l) => s + l.line_base, 0);
    return [
      {
        tax_type: "reteica",
        group_key: "reteica:UNKNOWN:unknown:0:0",
        concept: "Ciudad no determinada",
        account_code: config.account_code,
        base: totalBase,
        threshold_base: 0,
        rate: 0,
        calculated_amount: 0,
        applies: false,
        reasons: ["Ciudad no configurada para el tenant — requiere revisión manual"],
        line_numbers: lines.map((l) => l.source_line_number),
      },
    ];
  }

  const cityConfig = config.cities[resolvedCity];
  if (!cityConfig) {
    const totalBase = lines.reduce((s, l) => s + l.line_base, 0);
    return [
      {
        tax_type: "reteica",
        group_key: `reteica:${resolvedCity}:unknown:0:0`,
        concept: `Ciudad ${resolvedCity} no parametrizada`,
        account_code: config.account_code,
        base: totalBase,
        threshold_base: 0,
        rate: 0,
        calculated_amount: 0,
        applies: false,
        reasons: [`Ciudad ${resolvedCity} no encontrada en la parametrización de ReteICA`],
        line_numbers: lines.map((l) => l.source_line_number),
      },
    ];
  }

  const map = new Map<string, TaxBaseGroup>();

  for (const line of lines) {
    // Normalizar tipo de línea para ReteICA
    const rateKind: "service" | "purchase" =
      line.kind === "service" ? "service" : "purchase";

    const tier = cityConfig[rateKind];
    const key = `reteica:${resolvedCity}:${rateKind}:${tier.account_code}:${tier.rate}`;

    if (!map.has(key)) {
      map.set(key, {
        tax_type: "reteica",
        group_key: key,
        concept: `ReteICA ${resolvedCity} — ${rateKind === "service" ? "Servicios" : "Compras"}`,
        account_code: tier.account_code,
        base: 0,
        threshold_base: tier.base_cop,
        rate: tier.rate,
        calculated_amount: 0,
        applies: false,
        reasons: [],
        line_numbers: [],
      });
    }

    const group = map.get(key)!;
    group.base += line.line_base;
    group.line_numbers.push(line.source_line_number);

    if (line.requires_review && options.addReviewFlag) {
      group.reasons.push(`Línea ${line.source_line_number} requiere revisión: ${line.reasons.join("; ")}`);
    }
  }

  return Array.from(map.values());
}

// ─── Agrupación ReteIVA ────────────────────────────────────────────────────────

/**
 * Genera el único grupo ReteIVA.
 * Base = iva_total. Si iva_total = 0, el grupo marca applies = false.
 */
export function groupReteivaBases(
  ivaTotal: number,
  config: ReteIvaConfig,
  ivaLineNumbers: number[]
): TaxBaseGroup {
  return {
    tax_type: "reteiva",
    group_key: `reteiva:${config.account_code}:${config.fallback_rate}`,
    concept: "ReteIVA",
    account_code: config.account_code,
    legal_reference: config.legal_reference,
    base: ivaTotal,
    threshold_base: 0,
    rate: ivaTotal > 0 ? config.fallback_rate : 0,
    calculated_amount: 0,   // se calcula después
    applies: ivaTotal > 0 && config.apply_when.iva_greater_than_zero,
    reasons: ivaTotal <= 0
      ? ["IVA en cero; ReteIVA no aplica"]
      : [`Base ReteIVA = IVA total (${ivaTotal.toFixed(2)})`],
    line_numbers: ivaLineNumbers,
  };
}
