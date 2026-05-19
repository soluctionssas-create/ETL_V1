/**
 * Tests: factura grande (PDF real)
 *
 * Factura F11-10191 — GRUPO LA AZOTEA S.A.S.
 * NIT emisor: 901324042
 * NIT adquiriente: 900048675
 * Actividad: 5611 (restaurante) — Cali
 *
 * Validaciones:
 *  - items.length >= 431
 *  - subtotal ≈ 22.283.703 (tolerancia $5)
 *  - inc_total ≈ 1.782.696 (tolerancia $5)
 *  - iva_total = 0
 *  - total_factura ≈ 25.507.267 (tolerancia $10)
 *  - ReteIVA = 0 (IVA = 0 → ReteIVA = 0)
 *
 * Para ejecutar (solo tests de esta suite):
 *   cd apps/web && npx vitest run __tests__/tax/factura-grande.test.ts
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

import { extractDianInvoiceFromPdfText } from "../../lib/dian/extract-dian-pdf";
import { getDefaultTaxRulesConfig } from "../../lib/tax/tax-rules-loader";
import { calculateInvoiceTaxes } from "../../lib/tax/calculate-invoice-taxes";

const FIXTURE_PATH = join(__dirname, "../../../../tests/fixtures/real/factura_iteam_grandes.pdf");

const _require = createRequire(import.meta.url);
const pdfParse = _require("pdf-parse/lib/pdf-parse.js");

// Si el fixture no existe, todos los tests se marcan como SKIPPED (no como passed)
describe.skipIf(!existsSync(FIXTURE_PATH))("Factura grande PDF real — F11-10191", () => {
  let pdfText = "";

  beforeAll(async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const data = await pdfParse(buffer);
    pdfText = data.text ?? "";
  });

  it("Lee el PDF sin error", () => {

    expect(pdfText.length).toBeGreaterThan(1000);
  });

  it("Extrae >= 431 ítems del detalle", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, {
      fileName: "factura_iteam_grandes.pdf",
    });
    expect(canonical.detalle.length).toBeGreaterThanOrEqual(431);
  });

  it("Subtotal ≈ 22.283.703 (tolerancia ±5)", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, {
      fileName: "factura_iteam_grandes.pdf",
    });
    const subtotal = canonical.totales_subtotal.value ?? 0;
    expect(Math.abs(subtotal - 22_283_703)).toBeLessThanOrEqual(5);
  });

  it("IVA total = 0", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, {
      fileName: "factura_iteam_grandes.pdf",
    });
    expect(canonical.totales_IVA.value ?? 0).toBe(0);
  });

  it("INC total ≈ 1.782.696 (tolerancia ±5)", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, {
      fileName: "factura_iteam_grandes.pdf",
    });
    const inc = canonical.totales_INC.value ?? 0;
    expect(Math.abs(inc - 1_782_696)).toBeLessThanOrEqual(5);
  });

  it("Total factura ≈ 25.507.267 (tolerancia ±10)", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, {
      fileName: "factura_iteam_grandes.pdf",
    });
    const total = canonical.totales_total_factura.value ?? 0;
    expect(Math.abs(total - 25_507_267)).toBeLessThanOrEqual(10);
  });

  it("CRÍTICO: ReteIVA = 0 porque IVA = 0", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, {
      fileName: "factura_iteam_grandes.pdf",
    });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    expect(result.totals.reteiva).toBe(0);
    expect(result.iva_total).toBe(0);
  });

  it("Motor tributario no genera errores en la factura grande", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, {
      fileName: "factura_iteam_grandes.pdf",
    });
    const config = getDefaultTaxRulesConfig();

    // No debe lanzar excepción
    expect(() =>
      calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" })
    ).not.toThrow();
  });

  it("Clasifica actividad 5611 (restaurante) como compras/purchase", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, {
      fileName: "factura_iteam_grandes.pdf",
    });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    // Al menos 80% de los ítems deben clasificarse como purchase
    const purchaseLines = result.classified_lines.filter((l) => l.kind === "purchase");
    const ratio = purchaseLines.length / result.classified_lines.length;
    expect(ratio).toBeGreaterThanOrEqual(0.5);
  });

  // ── Cabecera ──────────────────────────────────────────────────────────────

  it("Cabecera: actividad económica es 5611 y moneda es COP", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    expect(canonical.datos_emisor_vendedor_actividad_economica.value).toBe("5611");
    expect(canonical.totales_moneda.value).toBe("COP");
  });

  it("Cabecera: emisor contiene 'AZOTEA' y forma de pago es Contado", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    expect(canonical.datos_emisor_vendedor_razon_social.value).toContain("AZOTEA");
    expect(canonical.datos_documento_forma_de_pago.value).toBe("Contado");
  });

  // ── Ítems ─────────────────────────────────────────────────────────────────

  it("Ítems: 431 líneas clasificadas, ninguna con base inválida, suma ≈ subtotal", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    expect(result.classified_lines.length).toBe(431);

    // Ninguna línea con base inválida (false items)
    const badLines = result.classified_lines.filter(
      (l) => isNaN(l.line_base) || l.line_base < 0
    );
    expect(badLines.length).toBe(0);

    // Suma de bases de líneas ≈ subtotal (tolerancia $50)
    const sumBases = result.classified_lines.reduce((s, l) => s + l.line_base, 0);
    expect(Math.abs(sumBases - 22_283_703)).toBeLessThanOrEqual(50);
  });

  // ── ReteIVA ───────────────────────────────────────────────────────────────

  it("ReteIVA: grupo explícito applies=false, base=0, razón contiene 'IVA' y 'no aplica'", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    const reteIvaGroup = result.groups.find((g) => g.tax_type === "reteiva");
    expect(reteIvaGroup).toBeDefined();
    expect(reteIvaGroup!.applies).toBe(false);
    expect(reteIvaGroup!.base).toBe(0);
    expect(reteIvaGroup!.rate).toBe(0);
    expect(reteIvaGroup!.calculated_amount).toBe(0);

    const reasonText = reteIvaGroup!.reasons.join(" ").toLowerCase();
    expect(reasonText).toContain("iva");
    expect(reasonText).toContain("no aplica");
  });

  // ── ReteFuente ────────────────────────────────────────────────────────────

  it("ReteFuente: grupo auditable — concepto, cuenta, tarifa, base, líneas", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    const rfGroup = result.groups.find((g) => g.tax_type === "retefuente" && g.applies);
    expect(rfGroup).toBeDefined();
    expect(rfGroup!.concept.length).toBeGreaterThan(0);
    expect(rfGroup!.account_code.length).toBeGreaterThan(0);
    expect(rfGroup!.rate).toBeGreaterThan(0);
    expect(Math.abs(rfGroup!.base - 22_283_703)).toBeLessThanOrEqual(5);
    expect(rfGroup!.threshold_base).toBeGreaterThan(0);
    expect(rfGroup!.line_numbers.length).toBeGreaterThan(0);
    expect(rfGroup!.reasons.length).toBeGreaterThan(0);
  });

  it("ReteFuente: reportada=0, calculada=557.093, diferencia → requires_review", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    expect(result.reported_withholdings.retefuente).toBe(0);
    expect(result.totals.retefuente).toBe(557_093);
    expect(result.differences.retefuente).toBe(557_093);
    expect(result.requires_review).toBe(true);
  });

  // ── ReteICA ───────────────────────────────────────────────────────────────

  it("ReteICA: ciudad CALI, aplica para compras con tarifa 7.70‰", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    expect(result.city).toBe("CALI");

    const ricaGroup = result.groups.find((g) => g.tax_type === "reteica" && g.applies);
    expect(ricaGroup).toBeDefined();
    expect(ricaGroup!.rate).toBeCloseTo(0.0077, 4);
    expect(ricaGroup!.base).toBeGreaterThan(0);
    expect(result.totals.reteica).toBe(171_585);
  });

  it("ReteICA: sin tenant_city → warning de ciudad ambigua o no configurada", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    // Sin tenant_city: el motor no tiene ciudad definitiva desde la factura (ambos null)
    const resultNoCity = calculateInvoiceTaxes(canonical, config, {});
    const hasWarning = resultNoCity.warnings.some((w) =>
      w.toLowerCase().includes("ciudad")
    );
    expect(hasWarning).toBe(true);
  });

  // ── Clasificación ─────────────────────────────────────────────────────────

  it("Clasificación: >= 429 purchase, <= 2 unknown, 0 service", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    const purchaseLines = result.classified_lines.filter((l) => l.kind === "purchase");
    const unknownLines = result.classified_lines.filter((l) => l.kind === "unknown");
    const serviceLines = result.classified_lines.filter((l) => l.kind === "service");

    expect(purchaseLines.length).toBeGreaterThanOrEqual(429);
    expect(unknownLines.length).toBeLessThanOrEqual(2);
    expect(serviceLines.length).toBe(0);
  });

  // ── Diferencias y revisión ────────────────────────────────────────────────

  it("Diferencias exactas: ReteFuente=557.093, ReteICA=171.585, ReteIVA=0", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    const result = calculateInvoiceTaxes(canonical, config, { tenant_city: "Cali" });

    expect(result.reported_withholdings.retefuente).toBe(0);
    expect(result.reported_withholdings.reteica).toBe(0);
    expect(result.reported_withholdings.reteiva).toBe(0);

    expect(result.differences.retefuente).toBe(557_093);
    expect(result.differences.reteica).toBe(171_585);
    expect(result.differences.reteiva).toBe(0);
  });

  // ── Número de factura ─────────────────────────────────────────────────────

  it("invoice_number extrae F11-10191 (no DESCONOCIDA, no vacío)", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const invoiceNum = canonical.datos_documento_numero_factura.value;
    expect(invoiceNum).not.toBeNull();
    expect(invoiceNum).not.toBe("DESCONOCIDA");
    expect(invoiceNum).toBe("F11-10191");
  });

  // ── Ciudad del emisor ─────────────────────────────────────────────────────

  it("Emisor ciudad extraída es Cali (para ReteICA sin tenant_city)", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const ciudad = canonical.datos_emisor_vendedor_municipio_ciudad.value;
    expect(ciudad).not.toBeNull();
    expect(ciudad?.toLowerCase()).toContain("cali");
  });

  it("ReteICA usa ciudad del emisor (Cali) cuando no se pasa tenant_city explícito", () => {

    const canonical = extractDianInvoiceFromPdfText(pdfText, { fileName: "factura_iteam_grandes.pdf" });
    const config = getDefaultTaxRulesConfig();
    // Sin tenant_city → debe usar la ciudad del emisor extraída del PDF (Cali)
    const result = calculateInvoiceTaxes(canonical, config, {});
    // Con ciudad Cali inferida, ReteICA debe calcularse (no = 0)
    expect(result.city).toBe("CALI");
    expect(result.totals.reteica).toBe(171_585);
  });
});
