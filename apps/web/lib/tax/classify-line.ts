/**
 * Clasificador de líneas de factura
 *
 * Determina si cada ítem es `purchase` (compra/bien) o `service` (servicio).
 * La clasificación se hace por matching de keywords en la descripción.
 * NO usa IA para calcular impuestos — solo para sugerir clasificación.
 */

import type {
  ClassifiedInvoiceLine,
  TaxLineKind,
  RetefuenteRule,
  RetefuenteConfig,
} from "./tax-types";
import type { DianCanonicalInvoiceLine } from "../dian/dian-canonical-types";

// ─── Listas de keywords ────────────────────────────────────────────────────────

/**
 * Keywords de SERVICIO — sin duplicados, en orden de especificidad.
 */
const SERVICE_KEYWORDS: RegExp[] = [
  /\bservicio\b/i,
  /\bmantenimiento\b/i,
  /\bsoporte\b/i,
  /\bconsultor[ií]a\b/i,
  /\bhonorarios?\b/i,
  /\bcomisi[oó]n\b/i,
  /\btransporte\b/i,
  /\bflete\b/i,
  /\bhotel\b/i,
  /\bhospedaje\b/i,
  /\brestaurante\b/i,
  /\blicencia\b/i,
  /\bsoftware\b/i,
  /\bsuscripci[oó]n\b/i,
  /\barrendamiento\b/i,
  /\balquiler\b/i,
  /\baseo\b/i,
  /\bvigilancia\b/i,
  /\bseguridad\b/i,
  /\bauditor[ií]a\b/i,
  /\bintermediac/i,
  /\bgestor/i,
  /\bcapacitaci[oó]n\b/i,
  /\bformaci[oó]n\b/i,
  /\bpropina\b/i,
  /\brecargo\b/i,
  /\bacompa[ñn]amiento\b/i,
];

/**
 * Keywords de COMPRA/BIEN — incluye alimentos, bebidas, productos de restaurante.
 */
const PURCHASE_KEYWORDS: RegExp[] = [
  // Bebidas alcohólicas
  /\bstella\b/i,
  /\bartois\b/i,
  /\bcorona\b/i,
  /\bheineken\b/i,
  /\bbavaria\b/i,
  /\bapertura\b/i,
  /\bcerveza\b/i,
  /\baguardiente\b/i,
  /\bwhisky\b/i,
  /\bvino\b/i,
  /\btequila\b/i,
  /\bron\b/i,
  /\bcocktail\b/i,
  /\bcoctel\b/i,
  /\btrago\b/i,
  // Bebidas no alcohólicas
  /\bcocacola\b/i,
  /\bcoca.cola\b/i,
  /\bginger\b/i,
  /\bsoda\b/i,
  /\bhatsu\b/i,
  /\bposterior\b/i,
  /\bpostobón\b/i,
  /\bpostobon\b/i,
  /\bjugo\b/i,
  /\blimonada\b/i,
  /\bnaranjada\b/i,
  /\bmalteada\b/i,
  /\bafrecho\b/i,
  /\bzumo\b/i,
  /\brefrigerio\b/i,
  /\bagua\b/i,
  /\bcaf[eé]\b/i,
  /\bt[eé]\b/i,
  // Alimentos
  /\bpollo\b/i,
  /\bcarne\b/i,
  /\bcerd[oa]\b/i,
  /\bres\b/i,
  /\bpescado\b/i,
  /\bmariscos?\b/i,
  /\bmarranit/i,
  /\bchorizo\b/i,
  /\bsalchich/i,
  /\bhamburg/i,
  /\bperro\s+caliente\b/i,
  /\bpapas?\b/i,
  /\barroz\b/i,
  /\bensalada\b/i,
  /\bsopa\b/i,
  /\bpizza\b/i,
  /\bpasta\b/i,
  /\btacos?\b/i,
  /\bbandeja\b/i,
  /\bdesayuno\b/i,
  /\balmuerzo\b/i,
  /\bcena\b/i,
  /\bmen[uú]\b/i,
  /\bplato\b/i,
  /\bbocadillo\b/i,
  /\bacompañamiento\b/i,
  /\bcheese\b/i,
  /\bbotell/i,
  /\bbebida\b/i,
  /\baliment/i,
  // Productos físicos
  /\bcompra\b/i,
  /\bmercanc[ií]a\b/i,
  /\bproducto\b/i,
  /\binsumo\b/i,
  /\bmateria\s+prima\b/i,
  /\bgasolina\b/i,
  /\bcombustible\b/i,
  /\bdie?sel\b/i,
  // Otros
  /\bunidad\b/i,
  /\bund\b/i,
  /\bventa\b/i,
];

/**
 * Normaliza el texto para comparación de keywords.
 */
function normalizeDesc(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar tildes
    .toLowerCase()
    .trim();
}

/**
 * Busca qué keywords coinciden en el texto.
 */
function matchKeywords(text: string, patterns: RegExp[]): string[] {
  const norm = normalizeDesc(text);
  return patterns.filter((p) => p.test(norm)).map((p) => p.source);
}

// ─── Clasificador principal ───────────────────────────────────────────────────

/**
 * Clasifica una sola línea del canonical como purchase/service/mixed/unknown.
 * Si se provee la config de ReteFuente, también asigna el concepto/cuenta.
 */
export function classifyLine(
  line: DianCanonicalInvoiceLine,
  lineIndex: number,
  retefuenteConfig?: RetefuenteConfig
): ClassifiedInvoiceLine {
  const desc = line.detalle_Descripcion?.value ?? "";
  const code = line.detalle_Codigo?.value ?? null;
  const qty = line.detalle_Cantidad?.value ?? 1;
  const price = line.detalle_Precio_unitario?.value ?? 0;
  const lineBase = line.detalle_total_linea?.value ?? price * qty;
  const ivaAmt = line.detalle_impuesto_iva?.value ?? 0;
  const ivaRate = line.detalle_iva_perc?.value ?? 0;
  const incAmt = line.detalle_impuesto_inc?.value ?? 0;
  const incRate = line.detalle_inc_perc?.value ?? 0;

  const serviceMatches = matchKeywords(desc, SERVICE_KEYWORDS);
  const purchaseMatches = matchKeywords(desc, PURCHASE_KEYWORDS);

  const reasons: string[] = [];
  let kind: TaxLineKind;
  let requiresReview = false;
  let confidence = 0.8;

  if (serviceMatches.length > 0 && purchaseMatches.length === 0) {
    kind = "service";
    reasons.push(`Clasificado como servicio: [${serviceMatches.join(", ")}]`);
  } else if (purchaseMatches.length > 0 && serviceMatches.length === 0) {
    kind = "purchase";
    reasons.push(`Clasificado como compra/bien: [${purchaseMatches.join(", ")}]`);
  } else if (serviceMatches.length > 0 && purchaseMatches.length > 0) {
    kind = "mixed";
    requiresReview = true;
    confidence = 0.5;
    reasons.push(
      `Clasificación mixta — servicios: [${serviceMatches.join(", ")}], compras: [${purchaseMatches.join(", ")}]`
    );
  } else {
    kind = "unknown";
    requiresReview = true;
    confidence = 0.3;
    reasons.push("Sin keywords conocidas en la descripción — requiere revisión manual");
  }

  // ── Asignar concepto ReteFuente ───────────────────────────────────────────
  let retefuenteConcept: string | undefined;
  let retefuenteAccount: string | undefined;

  if (retefuenteConfig) {
    const rule = findRetefuenteRule(desc, retefuenteConfig);
    retefuenteConcept = rule.concept;
    retefuenteAccount = rule.account_code;
    reasons.push(`ReteFuente: ${rule.concept} (${(rule.rate * 100).toFixed(1)}%)`);
  }

  return {
    line_id: `L${lineIndex + 1}`,
    source_line_number: lineIndex + 1,
    description: desc,
    code,
    quantity: typeof qty === "number" ? qty : 1,
    unit_price: typeof price === "number" ? price : 0,
    line_base: typeof lineBase === "number" ? lineBase : 0,
    iva_amount: typeof ivaAmt === "number" ? ivaAmt : 0,
    iva_rate: typeof ivaRate === "number" ? ivaRate : 0,
    inc_amount: typeof incAmt === "number" ? incAmt : 0,
    inc_rate: typeof incRate === "number" ? incRate : 0,
    kind,
    retefuente_concept: retefuenteConcept,
    retefuente_account: retefuenteAccount,
    confidence,
    reasons,
    requires_review: requiresReview,
  };
}

/**
 * Encuentra la regla ReteFuente más específica para una descripción.
 * Prioriza reglas con keywords que coincidan; fallback a `default_rule`.
 */
export function findRetefuenteRule(
  description: string,
  config: RetefuenteConfig
): RetefuenteRule {
  const norm = normalizeDesc(description);

  for (const rule of config.rules) {
    if (rule.keywords.length === 0) continue;
    if (rule.keywords.some((kw) => norm.includes(kw.toLowerCase()))) {
      return rule;
    }
  }

  return config.default_rule;
}

/**
 * Clasifica todas las líneas de una factura.
 */
export function classifyAllLines(
  lines: DianCanonicalInvoiceLine[],
  retefuenteConfig?: RetefuenteConfig
): ClassifiedInvoiceLine[] {
  return lines.map((line, idx) => classifyLine(line, idx, retefuenteConfig));
}
