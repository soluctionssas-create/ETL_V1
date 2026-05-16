/**
 * Tests de validación para el extractor canónico DIAN.
 *
 * Fixture utilizado: tests/fixtures/dian_FE1789.xml
 *
 * Para ejecutar:
 *   cd apps/web && npx vitest run __tests__/dian-extraction.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { extractDianInvoiceFromXml } from "../lib/dian/extract-dian-xml";
import { canonicalToFacturaDian, canonicalLinesToDetalles } from "../lib/dian";

// ─── Fixture ─────────────────────────────────────────────────────────────────
const FIXTURE_PATH = join(__dirname, "../../../tests/fixtures/dian_FE1789.xml");

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf-8");
}

// ─── Suite principal ──────────────────────────────────────────────────────────
describe("extractDianInvoiceFromXml — FE1789", () => {
  let xml: string;

  beforeAll(() => {
    xml = loadFixture();
  });

  it("debe cargar el fixture sin errores", () => {
    expect(xml).toBeTruthy();
    expect(xml.length).toBeGreaterThan(100);
  });

  it("extrae el número de factura FE1789", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_documento_numero_factura.value).toBe("FE1789");
    expect(canonical.datos_documento_numero_factura.source).toBe("xml");
  });

  it("extrae fecha de emisión 2026-03-05", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_documento_fecha_emision.value).toBe("2026-03-05");
  });

  it("extrae fecha de vencimiento 2026-03-12", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_documento_fecha_vencimiento.value).toBe("2026-03-12");
  });

  it("extrae moneda COP", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.totales_moneda.value).toBe("COP");
  });

  it("identifica forma de pago como Crédito (ID=2)", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_documento_forma_de_pago.value).toMatch(/cr[eé]dito/i);
  });

  it("extrae medio de pago 47", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_documento_medio_de_pago.value).toBe("47");
  });

  it("extrae razón social del emisor TRANSPORTES FENIX S.A.", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_emisor_vendedor_razon_social.value).toBe("TRANSPORTES FENIX S.A.");
  });

  it("extrae NIT del emisor 805023122", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_emisor_vendedor_nit_emisor.value).toBe("805023122");
  });

  it("extrae actividad económica 4923", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_emisor_vendedor_actividad_economica.value).toBe("4923");
  });

  it("extrae razón social del adquiriente FRUITT COL S.A.S.", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_adquiriente_comprador_nombre_razon_social.value).toBe("FRUITT COL S.A.S.");
  });

  it("extrae NIT del adquiriente 901814874", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_adquiriente_comprador_numero_documento.value).toBe("901814874");
  });

  it("extrae subtotal 3800000", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.totales_subtotal.value).toBe(3800000);
  });

  it("extrae IVA = 0", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.totales_IVA.value).toBe(0);
  });

  it("extrae total factura 3800000", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.totales_total_factura.value).toBe(3800000);
  });

  it("detecta exactamente 1 línea de detalle", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.detalle).toHaveLength(1);
  });

  it("línea 1: descripción SERVICIO DE TRANSPORTE TERRESTRE", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const line = canonical.detalle[0];
    expect(line.detalle_Descripcion.value).toBe("SERVICIO DE TRANSPORTE TERRESTRE");
  });

  it("línea 1: unidad de medida WSD", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const line = canonical.detalle[0];
    expect(line.detalle_UM.value).toBe("WSD");
  });

  it("línea 1: cantidad 1", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const line = canonical.detalle[0];
    expect(line.detalle_Cantidad.value).toBe(1);
  });

  it("línea 1: precio unitario 3800000", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const line = canonical.detalle[0];
    expect(line.detalle_Precio_unitario.value).toBe(3800000);
  });

  it("línea 1: total línea 3800000", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const line = canonical.detalle[0];
    expect(line.detalle_total_linea.value).toBe(3800000);
  });

  it("confidence >= 0.9 para campos extraídos de XML", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    expect(canonical.datos_documento_numero_factura.confidence).toBeGreaterThanOrEqual(0.9);
    expect(canonical.datos_emisor_vendedor_nit_emisor.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("no genera warnings de extracción para un XML válido", () => {
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    // Puede haber 0 o algún warning menor; no debe superar 3
    expect(canonical.extraction_warnings.length).toBeLessThanOrEqual(3);
  });
});

// ─── Suite canonicalToFacturaDian ─────────────────────────────────────────────
describe("canonicalToFacturaDian — FE1789", () => {
  it("genera el objeto plano con doc_numero_factura correcto", () => {
    const xml = loadFixture();
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const flat = canonicalToFacturaDian(canonical, "batch-test-001");
    expect(flat.doc_numero_factura).toBe("FE1789");
    expect(flat.batch_id).toBe("batch-test-001");
    expect(flat.emisor_nit).toBe("805023122");
    expect(flat.tot_total_factura).toBe(3800000);
    expect(flat.estado).toBe("extraida");
  });

  it("incluye canonical_invoice_json como objeto (para JSONB)", () => {
    const xml = loadFixture();
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const flat = canonicalToFacturaDian(canonical, "batch-test-001");
    expect(flat.canonical_invoice_json).toBeTruthy();
    expect(typeof flat.canonical_invoice_json).toBe("object");
  });
});

// ─── Suite canonicalLinesToDetalles ──────────────────────────────────────────
describe("canonicalLinesToDetalles — FE1789", () => {
  it("genera exactamente 1 fila de detalle", () => {
    const xml = loadFixture();
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const rows = canonicalLinesToDetalles(canonical);
    expect(rows).toHaveLength(1);
  });

  it("detalle_descripcion es SERVICIO DE TRANSPORTE TERRESTRE", () => {
    const xml = loadFixture();
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const rows = canonicalLinesToDetalles(canonical);
    expect(rows[0].detalle_descripcion).toBe("SERVICIO DE TRANSPORTE TERRESTRE");
  });

  it("detalle_precio_unitario_venta es 3800000", () => {
    const xml = loadFixture();
    const canonical = extractDianInvoiceFromXml(xml, { fileName: "dian_FE1789.xml" });
    const rows = canonicalLinesToDetalles(canonical);
    expect(rows[0].detalle_precio_unitario_venta).toBe(3800000);
  });
});
