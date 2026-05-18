import { describe, it, expect } from "vitest";
import { normalizeApiBaseUrl } from "../../lib/api";

// ---------------------------------------------------------------------------
// normalizeApiBaseUrl
// ---------------------------------------------------------------------------
describe("normalizeApiBaseUrl", () => {
  it("retorna /api/v1 cuando raw es undefined", () => {
    expect(normalizeApiBaseUrl(undefined)).toBe("/api/v1");
  });

  it("retorna /api/v1 cuando raw es string vacío", () => {
    expect(normalizeApiBaseUrl("")).toBe("/api/v1");
  });

  it("retorna /api/v1 cuando raw es solo BOM", () => {
    expect(normalizeApiBaseUrl("\uFEFF")).toBe("/api/v1");
  });

  it("retorna /api/v1 cuando raw es solo espacios", () => {
    expect(normalizeApiBaseUrl("   ")).toBe("/api/v1");
  });

  it("retorna /api/v1 cuando raw es BOM + espacios", () => {
    expect(normalizeApiBaseUrl("\uFEFF   ")).toBe("/api/v1");
  });

  it("elimina BOM al inicio: \\uFEFF/api/v1 → /api/v1", () => {
    expect(normalizeApiBaseUrl("\uFEFF/api/v1")).toBe("/api/v1");
  });

  it("elimina BOM al inicio en URL completa", () => {
    expect(normalizeApiBaseUrl("\uFEFFhttps://api.example.com/v1")).toBe(
      "https://api.example.com/v1"
    );
  });

  it("elimina espacios extremos: '  /api/v1  ' → '/api/v1'", () => {
    expect(normalizeApiBaseUrl("  /api/v1  ")).toBe("/api/v1");
  });

  it("elimina BOM + espacios combinados: '\\uFEFF /api/v1 '", () => {
    expect(normalizeApiBaseUrl("\uFEFF /api/v1 ")).toBe("/api/v1");
  });

  it("elimina zero-width space (U+200B)", () => {
    expect(normalizeApiBaseUrl("\u200B/api/v1")).toBe("/api/v1");
  });

  it("elimina zero-width non-joiner (U+200C)", () => {
    expect(normalizeApiBaseUrl("\u200C/api/v1")).toBe("/api/v1");
  });

  it("elimina word joiner (U+2060)", () => {
    expect(normalizeApiBaseUrl("\u2060/api/v1")).toBe("/api/v1");
  });

  it("no modifica URL limpia /api/v1", () => {
    expect(normalizeApiBaseUrl("/api/v1")).toBe("/api/v1");
  });

  it("no modifica URL externa limpia", () => {
    expect(normalizeApiBaseUrl("https://backend.empresa.com/api/v1")).toBe(
      "https://backend.empresa.com/api/v1"
    );
  });

  it("el resultado nunca produce %EF%BB%BF al construir URL", () => {
    const bomValue = "\uFEFF/api/v1";
    const normalized = normalizeApiBaseUrl(bomValue);
    const encoded = encodeURIComponent(normalized);
    expect(encoded).not.toContain("EF%BB%BF");
    expect(encoded).not.toContain("%EF%BB");
  });
});
