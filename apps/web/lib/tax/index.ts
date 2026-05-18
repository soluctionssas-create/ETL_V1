/**
 * Barrel del módulo lib/tax
 *
 * Motor tributario determinístico para facturas DIAN Colombia.
 * Fuente de verdad: archivos JSON de parametrización en /data/.
 */

// Tipos
export type {
  TaxLineKind,
  ClassifiedInvoiceLine,
  TaxBaseGroup,
  InvoiceTaxCalculationResult,
  RetefuenteRule,
  RetefuenteConfig,
  ReteicaCityConfig,
  ReteicaConfig,
  ReteIvaConfig,
  TaxRulesConfig,
  TaxEngineOptions,
  WithholdingComparison,
  WithholdingComparisonStatus,
} from "./tax-types";

// Cargador de reglas
export { loadTaxRulesConfig, getDefaultTaxRulesConfig, clearTaxRulesCache } from "./tax-rules-loader";

// Clasificación de líneas
export { classifyLine, classifyAllLines, findRetefuenteRule } from "./classify-line";

// Agrupación de bases
export { groupRetefuenteBases, groupReteicaBases, groupReteivaBases, normalizeCity } from "./group-tax-bases";

// Cálculos individuales
export { calculateRetefuente, totalRetefuente } from "./calculate-retefuente";
export { calculateReteica, totalReteica } from "./calculate-reteica";
export { calculateReteiva, totalReteiva } from "./calculate-reteiva";

// Orquestador principal
export { calculateInvoiceTaxes } from "./calculate-invoice-taxes";
