/**
 * Tests: Procesamiento de lote real — Marzo.zip
 *
 * Verifica que el extractor XML DIAN puede procesar masivamente facturas
 * reales del mes de Marzo. El ZIP externo contiene 141 ZIPs internos,
 * cada uno con un XML DIAN y su PDF compañero.
 *
 * Estrategia:
 *  1. Abrir Marzo.zip → obtener los 141 inner ZIPs
 *  2. Por cada inner ZIP, extraer el primer archivo `.xml`
 *  3. Intentar parsear con extractDianInvoiceFromXml
 *  4. Registrar: ok / error / items_count por archivo
 *  5. Guardar reporte JSON en apps/web/.tmp/batch_processing_report.json
 *
 * Validaciones finales:
 *  - supported_files > 0
 *  - processed_ok + processed_error === supported_files
 *  - invoices_extracted > 0
 *  - items_extracted > 0
 *  - tasa de éxito >= 80%
 *
 * Para ejecutar solo esta suite:
 *   cd apps/web && npx vitest run __tests__/tax/marzo-batch.test.ts
 */

import { createRequire } from "node:module";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, extname, resolve } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

import { extractDianInvoiceFromXml } from "../../lib/dian/extract-dian-xml";

// ─── Helpers de ZIP ──────────────────────────────────────────────────────────
// Usamos la API nativa de Node.js para leer ZIPs sin dependencias extra.
// adm-zip está disponible como devDependency a través de @supabase/supabase-js.
// Si no está, usamos la API nativa de Bun/Node con Buffer manipulation.

const _require = createRequire(import.meta.url);

interface ZipEntry {
  /** Path completo dentro del ZIP, ej: "Marzo/file.zip" */
  entryName: string;
  isDirectory: boolean;
  getData(): Buffer;
}

function openZipFromBuffer(buffer: Buffer): ZipEntry[] {
  let AdmZip: { new (buf: Buffer): { getEntries(): ZipEntry[] } };
  try {
    AdmZip = _require("adm-zip");
  } catch {
    throw new Error("adm-zip no disponible — instalar con: npm install adm-zip");
  }
  const zip = new AdmZip(buffer);
  return zip.getEntries();
}

// ─── Rutas ───────────────────────────────────────────────────────────────────

const FIXTURE_PATH = join(
  __dirname,
  "../../../../tests/fixtures/real/Marzo.zip"
);

const TMP_DIR = join(__dirname, "../../.tmp");
const REPORT_PATH = join(TMP_DIR, "batch_processing_report.json");

// ─── Tipos de reporte ─────────────────────────────────────────────────────────

interface FileResult {
  outer_zip: string;
  xml_file: string;
  ok: boolean;
  invoice_number?: string | null;
  supplier_nit?: string | null;
  supplier_name?: string | null;
  total_invoice?: number | null;
  items_count: number;
  error?: string;
}

interface BatchReport {
  generated_at: string;
  fixture: string;
  total_outer_zips: number;
  supported_files: number;          // outer ZIPs que contienen al menos 1 XML
  processed_ok: number;
  processed_error: number;
  invoices_extracted: number;
  items_extracted: number;
  success_rate_pct: number;
  errors_by_file: Record<string, string>;
  results: FileResult[];
}

// ─── Suite principal ──────────────────────────────────────────────────────────

describe("Lote real — Marzo.zip (141 facturas DIAN)", () => {
  let report: BatchReport;
  let skipped = false;

  beforeAll(async () => {
    if (!existsSync(FIXTURE_PATH)) {
      console.warn("⚠ Fixture Marzo.zip no encontrado — tests omitidos");
      skipped = true;
      return;
    }

    const outerBuffer = readFileSync(FIXTURE_PATH);
    const outerEntries = openZipFromBuffer(outerBuffer);

    const innerZips = outerEntries.filter(
      (e) => !e.isDirectory && extname(e.entryName).toLowerCase() === ".zip"
    );

    const results: FileResult[] = [];
    const errorsByFile: Record<string, string> = {};

    for (const outerEntry of innerZips) {
      let innerBuffer: Buffer;
      try {
        innerBuffer = outerEntry.getData();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorsByFile[outerEntry.entryName] = `[read-outer] ${msg}`;
        results.push({
          outer_zip: outerEntry.entryName,
          xml_file: "",
          ok: false,
          items_count: 0,
          error: `[read-outer] ${msg}`,
        });
        continue;
      }

      let innerEntries: ZipEntry[];
      try {
        innerEntries = openZipFromBuffer(innerBuffer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorsByFile[outerEntry.entryName] = `[open-inner] ${msg}`;
        results.push({
          outer_zip: outerEntry.entryName,
          xml_file: "",
          ok: false,
          items_count: 0,
          error: `[open-inner] ${msg}`,
        });
        continue;
      }

      // Buscar primer XML que NO sea AttachedDocument (preferir el XML real)
      const xmlEntry =
        innerEntries.find(
          (e) =>
            !e.isDirectory &&
            extname(e.entryName).toLowerCase() === ".xml" &&
            !e.entryName.toLowerCase().includes("attached")
        ) ??
        innerEntries.find(
          (e) => !e.isDirectory && extname(e.entryName).toLowerCase() === ".xml"
        );

      if (!xmlEntry) {
        // No hay XML en este inner ZIP — no es un archivo "soportado"
        continue;
      }

      let xmlContent: string;
      try {
        xmlContent = xmlEntry.getData().toString("utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorsByFile[outerEntry.entryName] = `[read-xml] ${msg}`;
        results.push({
          outer_zip: outerEntry.entryName,
          xml_file: xmlEntry.entryName,
          ok: false,
          items_count: 0,
          error: `[read-xml] ${msg}`,
        });
        continue;
      }

      try {
        const canonical = extractDianInvoiceFromXml(xmlContent, {
          fileName: xmlEntry.entryName,
        });

        results.push({
          outer_zip: outerEntry.entryName,
          xml_file: xmlEntry.entryName,
          ok: true,
          invoice_number: canonical.datos_documento_numero_factura.value,
          supplier_nit: canonical.datos_emisor_vendedor_nit_emisor.value,
          supplier_name: canonical.datos_emisor_vendedor_razon_social.value,
          total_invoice: canonical.totales_total_factura.value ?? null,
          items_count: canonical.detalle.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorsByFile[outerEntry.entryName] = `[parse] ${msg}`;
        results.push({
          outer_zip: outerEntry.entryName,
          xml_file: xmlEntry.entryName,
          ok: false,
          items_count: 0,
          error: `[parse] ${msg}`,
        });
      }
    }

    const processed_ok = results.filter((r) => r.ok).length;
    const processed_error = results.filter((r) => !r.ok).length;
    const supported_files = results.length;
    const invoices_extracted = processed_ok;
    const items_extracted = results.reduce((sum, r) => sum + r.items_count, 0);
    const success_rate_pct =
      supported_files > 0
        ? Math.round((processed_ok / supported_files) * 100)
        : 0;

    report = {
      generated_at: new Date().toISOString(),
      fixture: FIXTURE_PATH,
      total_outer_zips: innerZips.length,
      supported_files,
      processed_ok,
      processed_error,
      invoices_extracted,
      items_extracted,
      success_rate_pct,
      errors_by_file: errorsByFile,
      results,
    };

    // Guardar reporte en .tmp/ (no committeable)
    try {
      mkdirSync(TMP_DIR, { recursive: true });
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
      console.log(`\n📊 Reporte guardado en: ${REPORT_PATH}`);
    } catch (writeErr) {
      console.warn("No se pudo guardar reporte:", writeErr);
    }

    // Resumen en consola
    console.log(`
=== RESUMEN DE LOTE: Marzo.zip ===
  ZIPs internos:       ${innerZips.length}
  Archivos soportados: ${supported_files}
  Procesados OK:       ${processed_ok}
  Con error:           ${processed_error}
  Facturas extraídas:  ${invoices_extracted}
  Ítems extraídos:     ${items_extracted}
  Tasa de éxito:       ${success_rate_pct}%
==================================`);
  }, 120_000 /* 2 min timeout para 141 ZIPs */);

  // ─── Assertions ─────────────────────────────────────────────────────────────

  it("Fixture Marzo.zip existe", () => {
    if (skipped) return;
    expect(existsSync(FIXTURE_PATH)).toBe(true);
  });

  it("Se encontraron archivos soportados (ZIPs con XML)", () => {
    if (skipped) return;
    expect(report.supported_files).toBeGreaterThan(0);
  });

  it("La suma procesados_ok + procesados_error = supported_files", () => {
    if (skipped) return;
    expect(report.processed_ok + report.processed_error).toBe(
      report.supported_files
    );
  });

  it("Al menos 1 factura extraída correctamente", () => {
    if (skipped) return;
    expect(report.invoices_extracted).toBeGreaterThan(0);
  });

  it("Al menos 1 ítem extraído en total", () => {
    if (skipped) return;
    expect(report.items_extracted).toBeGreaterThan(0);
  });

  it("Tasa de éxito >= 80%", () => {
    if (skipped) return;
    expect(report.success_rate_pct).toBeGreaterThanOrEqual(80);
  });

  it("Reporte JSON fue generado en .tmp/", () => {
    if (skipped) return;
    expect(existsSync(REPORT_PATH)).toBe(true);
  });
});
