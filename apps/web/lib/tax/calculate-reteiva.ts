/**
 * Calculador de ReteIVA (Retención del IVA)
 *
 * REGLA CRÍTICA: Si IVA = 0, ReteIVA = 0 (obligatorio, sin excepción).
 * El INC NO es base de ReteIVA.
 *
 * Fuente de verdad: `reteiva_config.json`.
 *
 * Algoritmo:
 *  1. Si iva_total <= 0 → no aplica, retorna grupo con calculated_amount = 0.
 *  2. Si iva_total > 0 → base = iva_total, rate = fallback_rate (0.15).
 *  3. calculated_amount = round(base * rate, 0).
 */

import type { TaxBaseGroup, ReteIvaConfig } from "./tax-types";

/**
 * Calcula ReteIVA para el grupo único.
 * Modifica `calculated_amount` y `applies` in-place.
 *
 * @param group - Grupo ReteIVA ya construido por `groupReteivaBases`.
 * @param config - Configuración de ReteIVA.
 * @param ivaTotal - Total de IVA de la factura.
 */
export function calculateReteiva(
  group: TaxBaseGroup,
  config: ReteIvaConfig,
  ivaTotal: number
): TaxBaseGroup {
  // REGLA FUNDAMENTAL: IVA = 0 → ReteIVA no aplica
  if (ivaTotal <= 0) {
    group.applies = false;
    group.calculated_amount = 0;
    group.rate = 0;
    group.base = 0;
    group.reasons = ["IVA en cero; ReteIVA no aplica (INC no es base de ReteIVA)"];
    return group;
  }

  // Si el config dice que solo aplica cuando iva > 0 (y está cumplido)
  if (!config.apply_when.iva_greater_than_zero) {
    group.applies = false;
    group.calculated_amount = 0;
    group.reasons.push("Configuración: apply_when.iva_greater_than_zero = false");
    return group;
  }

  group.applies = true;
  group.base = ivaTotal;
  group.rate = config.fallback_rate;
  group.calculated_amount = Math.round(ivaTotal * config.fallback_rate);
  group.reasons = [
    `IVA total: ${ivaTotal.toFixed(2)}`,
    `Tarifa ReteIVA: ${(config.fallback_rate * 100).toFixed(0)}%`,
    `Calculado: ${ivaTotal.toFixed(2)} × ${config.fallback_rate} = ${group.calculated_amount.toFixed(2)}`,
    config.legal_reference ?? "Art. 437-1 ET",
  ];

  return group;
}

/**
 * Suma ReteIVA total (solo grupo que aplica).
 */
export function totalReteiva(groups: TaxBaseGroup[]): number {
  return groups
    .filter((g) => g.tax_type === "reteiva" && g.applies)
    .reduce((s, g) => s + g.calculated_amount, 0);
}
