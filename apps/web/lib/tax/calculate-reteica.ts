/**
 * Calculador de ReteICA (Retención de Industria y Comercio)
 *
 * Motor determinístico. Fuente de verdad: `reteica_ciudades.json`.
 *
 * Algoritmo:
 *  1. Determinar ciudad: tenant_city > buyer_city > supplier_city (fallback con warning).
 *  2. Normalizar ciudad a clave de parametrización.
 *  3. Si ciudad no encontrada → requires_review = true, calculado = 0.
 *  4. Calcular por grupo ciudad + tipo (service | purchase).
 *  5. Si base >= base_cop → aplica.
 *  6. calculated_amount = round(base * rate, 0).
 */

import type { TaxBaseGroup, ReteicaConfig } from "./tax-types";

/**
 * Calcula ReteICA para todos los grupos.
 * Modifica `calculated_amount` y `applies` in-place.
 */
export function calculateReteica(
  groups: TaxBaseGroup[],
  _config: ReteicaConfig
): TaxBaseGroup[] {
  for (const group of groups) {
    if (group.tax_type !== "reteica") continue;

    // Grupo de ciudad no determinada o no parametrizada — no calcular
    if (group.rate === 0 || group.threshold_base === 0) {
      group.applies = false;
      group.calculated_amount = 0;
      continue;
    }

    if (group.base >= group.threshold_base) {
      group.applies = true;
      group.calculated_amount = Math.round(group.base * group.rate);
      group.reasons.push(
        `Aplica: base ${group.base.toFixed(2)} >= umbral ${group.threshold_base.toFixed(2)} → ` +
        `${(group.rate * 100 * 10).toFixed(2)}‰ = ${group.calculated_amount.toFixed(2)}`
      );
    } else {
      group.applies = false;
      group.calculated_amount = 0;
      group.reasons.push(
        `No aplica: base ${group.base.toFixed(2)} < umbral ${group.threshold_base.toFixed(2)}`
      );
    }
  }

  return groups;
}

/**
 * Suma el total de ReteICA calculado (solo grupos que aplican).
 */
export function totalReteica(groups: TaxBaseGroup[]): number {
  return groups
    .filter((g) => g.tax_type === "reteica" && g.applies)
    .reduce((s, g) => s + g.calculated_amount, 0);
}
