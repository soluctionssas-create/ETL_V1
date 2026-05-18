/**
 * Smoke test: Detección automática de BOM en NEXT_PUBLIC_API_URL
 *
 * Este test corre en CI y en local para garantizar que el valor de la
 * variable de entorno nunca produce URLs con el Byte Order Mark
 * (%EF%BB%BF) que causaría HTTP 404 en producción.
 *
 * Contexto: Bug producción Task 13 (2025-05-17) — NEXT_PUBLIC_API_URL
 * tenía BOM en Vercel → browser construía /%EF%BB%BF/api/v1/... → 404.
 * Fix: normalizeApiBaseUrl() en lib/api.ts (Task 14, 2025-05-18).
 */

import { describe, it, expect } from "vitest";
import { normalizeApiBaseUrl } from "../../lib/api";

const BOM_ENCODED = "%EF%BB%BF";
const BOM_CHAR = "\uFEFF";

// Simula exactamente cómo Next.js bake la env var en el bundle
const RAW_NEXT_PUBLIC_API_URL = process.env["NEXT_PUBLIC_API_URL"];

describe("smoke: BOM detection en NEXT_PUBLIC_API_URL", () => {
  it("NEXT_PUBLIC_API_URL (raw) no contiene BOM", () => {
    if (!RAW_NEXT_PUBLIC_API_URL) return; // no seteada en CI → ok
    expect(RAW_NEXT_PUBLIC_API_URL).not.toContain(BOM_CHAR);
    expect(RAW_NEXT_PUBLIC_API_URL).not.toContain("%EF%BB%BF");
  });

  it("normalizeApiBaseUrl(NEXT_PUBLIC_API_URL) produce URL sin BOM", () => {
    const normalized = normalizeApiBaseUrl(RAW_NEXT_PUBLIC_API_URL);
    expect(normalized).not.toContain(BOM_CHAR);
  });

  it("URL construida desde API_BASE no contiene %EF%BB%BF en path", () => {
    const normalized = normalizeApiBaseUrl(RAW_NEXT_PUBLIC_API_URL);
    // Simula cómo apiFetch construye la URL
    const fullUrl = new URL(
      `${normalized}/invoices/batches`,
      "https://etl-v1.vercel.app"
    );
    const urlString = fullUrl.toString();

    expect(urlString).not.toContain(BOM_ENCODED);
    expect(urlString).not.toContain(BOM_CHAR);
    // El path debe empezar con /api/v1 o con el dominio real
    expect(fullUrl.pathname).not.toMatch(/^\/%EF/);
  });

  it("escenario BOM: simula valor corrupto de Vercel → URL limpia", () => {
    const corruptValue = `${BOM_CHAR}/api/v1`;
    const normalized = normalizeApiBaseUrl(corruptValue);
    const fullUrl = new URL(`${normalized}/invoices/batches`, "https://etl-v1.vercel.app");

    // La URL construida NO debe contener BOM encoded
    expect(fullUrl.toString()).not.toContain(BOM_ENCODED);
    // El path debe ser /api/v1/invoices/batches, no /%EF%BB%BF/...
    expect(fullUrl.pathname).toBe("/api/v1/invoices/batches");
  });

  it("escenario URL externa con BOM → normaliza correctamente", () => {
    const corruptExternal = `${BOM_CHAR}https://backend.empresa.com/api/v1`;
    const normalized = normalizeApiBaseUrl(corruptExternal);
    expect(normalized).toBe("https://backend.empresa.com/api/v1");
    expect(normalized).not.toContain(BOM_CHAR);
  });

  it("escenario espacios en env var → trim correcto", () => {
    const withSpaces = "  /api/v1  ";
    const normalized = normalizeApiBaseUrl(withSpaces);
    const fullUrl = new URL(`${normalized}/invoices/batches`, "https://etl-v1.vercel.app");
    expect(fullUrl.pathname).toBe("/api/v1/invoices/batches");
  });
});
