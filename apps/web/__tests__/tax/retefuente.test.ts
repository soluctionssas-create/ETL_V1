/**
 * Tests: ReteFuente motor tributario
 *
 * Valida el cálculo determinístico de ReteFuente con las reglas parametrizadas.
 */
import { describe, it, expect } from "vitest";
import { getDefaultTaxRulesConfig } from "../../lib/tax/tax-rules-loader";
import { groupRetefuenteBases } from "../../lib/tax/group-tax-bases";
import { calculateRetefuente, totalRetefuente } from "../../lib/tax/calculate-retefuente";
import { classifyAllLines } from "../../lib/tax/classify-line";
import type { DianCanonicalInvoiceLine } from "../../lib/dian/dian-canonical-types";
import { pdfField, notFound } from "../../lib/dian/dian-canonical-types";

function mockLine(
  n: number,
  desc: string,
  base: number
): DianCanonicalInvoiceLine {
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

describe("ReteFuente — motor tributario", () => {
  const config = getDefaultTaxRulesConfig();

  it("No aplica cuando la base es menor al umbral mínimo (compras generales)", () => {
    // Umbral default: 523.740 COP
    const lines = [mockLine(1, "Papas fritas", 100_000)];
    const classified = classifyAllLines(lines, config.retefuente);
    const groups = groupRetefuenteBases(classified, config.retefuente);
    calculateRetefuente(groups, config.retefuente);

    expect(groups[0].applies).toBe(false);
    expect(groups[0].calculated_amount).toBe(0);
  });

  it("Aplica cuando la base supera el umbral (compras generales)", () => {
    // Base: 1.000.000 > umbral 523.740, tarifa 2.5%
    const lines = [mockLine(1, "Mercancía varios", 1_000_000)];
    const classified = classifyAllLines(lines, config.retefuente);
    const groups = groupRetefuenteBases(classified, config.retefuente);
    calculateRetefuente(groups, config.retefuente);

    expect(groups[0].applies).toBe(true);
    // 1.000.000 * 0.025 = 25.000
    expect(groups[0].calculated_amount).toBe(25_000);
  });

  it("Suma total correcta para múltiples líneas", () => {
    const lines = [
      mockLine(1, "Mercancía A", 700_000),
      mockLine(2, "Mercancía B", 800_000),
    ];
    const classified = classifyAllLines(lines, config.retefuente);
    const groups = groupRetefuenteBases(classified, config.retefuente);
    calculateRetefuente(groups, config.retefuente);

    const total = totalRetefuente(groups);
    // Base total = 1.500.000, tarifa 2.5% = 37.500
    expect(total).toBe(37_500);
  });

  it("Agrupa líneas con mismo concepto en un único grupo", () => {
    const lines = [
      mockLine(1, "Compra producto A", 600_000),
      mockLine(2, "Compra producto B", 400_000),
    ];
    const classified = classifyAllLines(lines, config.retefuente);
    const groups = groupRetefuenteBases(classified, config.retefuente);

    // Mismo concepto → mismo grupo
    expect(groups.length).toBe(1);
    expect(groups[0].base).toBe(1_000_000);
  });

  it("Clasifica servicios con concepto distinto a compras", () => {
    const lines = [mockLine(1, "Honorarios profesionales", 1_000_000)];
    const classified = classifyAllLines(lines, config.retefuente);

    expect(classified[0].kind).toBe("service");
  });
});
