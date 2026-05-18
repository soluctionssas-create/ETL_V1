/**
 * Calculador de ReteFuente (Retención en la Fuente)
 *
 * Motor determinístico: usa las reglas parametrizadas de `retefuente_2026.json`.
 * NO usa IA para calcular — solo usa reglas auditables.
 *
 * Algoritmo:
 *  1. Recibe grupos ya agrupados por concepto/cuenta/tarifa.
 *  2. Si base >= base_cop mínima → aplica retención.
 *  3. calculated_amount = round(base * rate, 0).
 *  4. Si no supera base mínima → calculated_amount = 0, applies = false.
 */

import type { TaxBaseGroup, RetefuenteConfig } from "./tax-types";

/**
 * Calcula ReteFuente para todos los grupos.
 * Modifica `calculated_amount` y `applies` in-place y devuelve los grupos.
 */
export function calculateRetefuente(
  groups: TaxBaseGroup[],
  _config: RetefuenteConfig
): TaxBaseGroup[] {
  for (const group of groups) {
    if (group.tax_type !== "retefuente") continue;

    if (group.base >= group.threshold_base) {
      group.applies = true;
      group.calculated_amount = Math.round(group.base * group.rate);
      group.reasons.push(
        `Aplica: base ${group.base.toFixed(2)} >= umbral ${group.threshold_base.toFixed(2)} → ` +
        `${(group.rate * 100).toFixed(2)}% = ${group.calculated_amount.toFixed(2)}`
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
 * Suma el total de ReteFuente calculado (solo grupos que aplican).
 */
export function totalRetefuente(groups: TaxBaseGroup[]): number {
  return groups
    .filter((g) => g.tax_type === "retefuente" && g.applies)
    .reduce((s, g) => s + g.calculated_amount, 0);
}
