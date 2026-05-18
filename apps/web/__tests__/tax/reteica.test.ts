/**
 * Tests: ReteICA motor tributario
 *
 * Valida el cálculo de ReteICA por ciudad.
 */
import { describe, it, expect } from "vitest";
import { getDefaultTaxRulesConfig } from "../../lib/tax/tax-rules-loader";
import { groupReteicaBases, normalizeCity } from "../../lib/tax/group-tax-bases";
import { calculateReteica, totalReteica } from "../../lib/tax/calculate-reteica";
import { classifyAllLines } from "../../lib/tax/classify-line";
import type { DianCanonicalInvoiceLine } from "../../lib/dian/dian-canonical-types";
import { pdfField, notFound } from "../../lib/dian/dian-canonical-types";

function mockLine(n: number, desc: string, base: number): DianCanonicalInvoiceLine {
  return {
    detalle_Nro: pdfField(n, ""),
    detalle_Codigo: pdfField(null, ""),
    detalle_Descripcion: pdfField(desc, ""),
    detalle_UM: pdfField("UND", ""),
    detalle_Cantidad: pdfField(1, ""),
    detalle_Precio_unitario: pdfField(base, ""),
    detalle_Descuento_detalle: notFound(),
    detalle_Recargo_detalle: notFound(),
    detalle_impuesto_iva: pdfField(0, ""),
    detalle_iva_perc: pdfField(0, ""),
    detalle_impuesto_inc: pdfField(0, ""),
    detalle_inc_perc: pdfField(0, ""),
    detalle_precio_unitario_venta: pdfField(base, ""),
    detalle_total_linea: pdfField(base, ""),
    detalle_base_gravable: pdfField(base, ""),
    detalle_notas: notFound(),
    detalle_propiedades_adicionales_json: notFound(),
  };
}

describe("normalizeCity", () => {
  it("normaliza Bogotá, D.C. → BOGOTA", () => {
    expect(normalizeCity("Bogotá, D.C.")).toBe("BOGOTA");
  });
  it("normaliza CALI → CALI", () => {
    expect(normalizeCity("Cali")).toBe("CALI");
  });
  it("normaliza Santiago de Cali → CALI", () => {
    expect(normalizeCity("Santiago de Cali")).toBe("CALI");
  });
  it("retorna null para null", () => {
    expect(normalizeCity(null)).toBeNull();
  });
  it("retorna null para string vacío", () => {
    expect(normalizeCity("")).toBeNull();
  });
});

describe("ReteICA — Cali compras", () => {
  const config = getDefaultTaxRulesConfig();

  it("No aplica cuando la base es menor al umbral (Cali compras = 785.610)", () => {
    const lines = [mockLine(1, "Cerveza Águila", 500_000)];
    const classified = classifyAllLines(lines, config.retefuente);
    const groups = groupReteicaBases(classified, config.reteica, "CALI");
    calculateReteica(groups, config.reteica);

    const purchaseGroups = groups.filter((g) => g.group_key.includes("purchase"));
    expect(purchaseGroups[0]?.applies).toBe(false);
    expect(purchaseGroups[0]?.calculated_amount).toBe(0);
  });

  it("Aplica ReteICA compras cuando base supera umbral (Cali: 0.77% / base 785.610)", () => {
    const lines = [
      mockLine(1, "Cerveza Corona 330ml", 5_000_000),
      mockLine(2, "Agua Cristal 1.5L", 3_000_000),
    ];
    const classified = classifyAllLines(lines, config.retefuente);
    const groups = groupReteicaBases(classified, config.reteica, "CALI");
    calculateReteica(groups, config.reteica);

    const total = totalReteica(groups);
    // Base = 8.000.000, tarifa = 0.0077 → 61.600
    expect(total).toBe(61_600);
  });
});

describe("ReteICA — sin ciudad", () => {
  const config = getDefaultTaxRulesConfig();

  it("Genera grupo sin cálculo cuando la ciudad es null", () => {
    const lines = [mockLine(1, "Servicio varios", 2_000_000)];
    const classified = classifyAllLines(lines, config.retefuente);
    const groups = groupReteicaBases(classified, config.reteica, null);
    calculateReteica(groups, config.reteica);

    expect(groups[0].applies).toBe(false);
    expect(groups[0].calculated_amount).toBe(0);
    expect(groups[0].reasons.some((r) => r.includes("Ciudad no configurada"))).toBe(true);
  });
});
