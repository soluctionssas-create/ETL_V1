import { describe, it, expect } from "vitest";
import {
  normalizeNit,
  normalizeSearchText,
  buildTaxCalculationFilters,
  MAX_LIMIT,
} from "../../lib/tax/tax-calculation-filters";

// ---------------------------------------------------------------------------
// normalizeNit
// ---------------------------------------------------------------------------
describe("normalizeNit", () => {
  it('quita puntos y guión: "900.048.675-1" → "9000486751"', () => {
    expect(normalizeNit("900.048.675-1")).toBe("9000486751");
  });

  it("deja NIT sin formato sin cambios", () => {
    expect(normalizeNit("900048675")).toBe("900048675");
  });

  it("quita espacios internos", () => {
    expect(normalizeNit("900 048 675")).toBe("900048675");
  });

  it("quita combinación de puntos, guión y espacios", () => {
    expect(normalizeNit("901.324.042-1")).toBe("9013240421");
  });
});

// ---------------------------------------------------------------------------
// normalizeSearchText
// ---------------------------------------------------------------------------
describe("normalizeSearchText", () => {
  it("hace trim de espacios extremos", () => {
    expect(normalizeSearchText("  AZOTEA  ")).toBe("AZOTEA");
  });

  it("elimina comodines SQL: % _ \\", () => {
    expect(normalizeSearchText("AZ%OT_EA\\CORP")).toBe("AZOTEACORP");
  });

  it("limita a 100 caracteres por defecto", () => {
    const long = "A".repeat(200);
    expect(normalizeSearchText(long).length).toBe(100);
  });

  it("respeta maxLen personalizado", () => {
    expect(normalizeSearchText("ABCDEF", 3)).toBe("ABC");
  });

  it("preserva texto normal sin cambios", () => {
    expect(normalizeSearchText("GRUPO LA AZOTEA S.A.S.")).toBe(
      "GRUPO LA AZOTEA S.A.S."
    );
  });
});

// ---------------------------------------------------------------------------
// buildTaxCalculationFilters
// ---------------------------------------------------------------------------
describe("buildTaxCalculationFilters", () => {
  function sp(obj: Record<string, string>): URLSearchParams {
    return new URLSearchParams(obj);
  }

  // ── Paginación ──────────────────────────────────────────────────────────

  it("sin params: limit=50, offset=0", () => {
    const f = buildTaxCalculationFilters(sp({}));
    expect(f.limit).toBe(50);
    expect(f.offset).toBe(0);
  });

  it("limit dentro del rango se respeta", () => {
    const f = buildTaxCalculationFilters(sp({ limit: "100" }));
    expect(f.limit).toBe(100);
  });

  it("limit=1 mínimo aceptable", () => {
    const f = buildTaxCalculationFilters(sp({ limit: "1" }));
    expect(f.limit).toBe(1);
  });

  it("limit > MAX_LIMIT se clampea a MAX_LIMIT", () => {
    const f = buildTaxCalculationFilters(sp({ limit: "9999" }));
    expect(f.limit).toBe(MAX_LIMIT);
  });

  it("limit=0 usa default", () => {
    const f = buildTaxCalculationFilters(sp({ limit: "0" }));
    expect(f.limit).toBe(50);
  });

  it("offset negativo normaliza a 0", () => {
    const f = buildTaxCalculationFilters(sp({ offset: "-10" }));
    expect(f.offset).toBe(0);
  });

  it("offset válido se respeta", () => {
    const f = buildTaxCalculationFilters(sp({ offset: "100" }));
    expect(f.offset).toBe(100);
  });

  // ── Filtros NIT ─────────────────────────────────────────────────────────

  it("?supplierNit solo establece supplierNit (no nit)", () => {
    const f = buildTaxCalculationFilters(sp({ supplierNit: "901324042" }));
    expect(f.supplierNit).toBe("901324042");
    expect(f.nit).toBeUndefined();
    expect(f.buyerNit).toBeUndefined();
  });

  it("?buyerNit solo establece buyerNit", () => {
    const f = buildTaxCalculationFilters(sp({ buyerNit: "900048675" }));
    expect(f.buyerNit).toBe("900048675");
    expect(f.nit).toBeUndefined();
    expect(f.supplierNit).toBeUndefined();
  });

  it("?nit establece alias genérico (supplier OR buyer)", () => {
    const f = buildTaxCalculationFilters(sp({ nit: "900048675" }));
    expect(f.nit).toBe("900048675");
    expect(f.supplierNit).toBeUndefined();
    expect(f.buyerNit).toBeUndefined();
  });

  it("?supplierNit con formato se normaliza", () => {
    const f = buildTaxCalculationFilters(sp({ supplierNit: "901.324.042-1" }));
    expect(f.supplierNit).toBe("9013240421");
  });

  it("?nit con espacios y guión se normaliza", () => {
    const f = buildTaxCalculationFilters(sp({ nit: "900.048.675-1" }));
    expect(f.nit).toBe("9000486751");
  });

  // ── Filtros nombre ───────────────────────────────────────────────────────

  it("?supplierName=azotea establece supplierName", () => {
    const f = buildTaxCalculationFilters(sp({ supplierName: "azotea" }));
    expect(f.supplierName).toBe("azotea");
    expect(f.name).toBeUndefined();
  });

  it("?buyerName establece buyerName", () => {
    const f = buildTaxCalculationFilters(sp({ buyerName: "PROMOTORA" }));
    expect(f.buyerName).toBe("PROMOTORA");
  });

  it("?name establece alias genérico (supplier OR buyer)", () => {
    const f = buildTaxCalculationFilters(sp({ name: "promotora" }));
    expect(f.name).toBe("promotora");
    expect(f.supplierName).toBeUndefined();
    expect(f.buyerName).toBeUndefined();
  });

  it("?supplierName con comodines SQL se sanea", () => {
    const f = buildTaxCalculationFilters(sp({ supplierName: "AZ%OT_EA" }));
    expect(f.supplierName).toBe("AZOTEA");
  });

  // ── requiresReview ───────────────────────────────────────────────────────

  it("?requiresReview=true → boolean true", () => {
    const f = buildTaxCalculationFilters(sp({ requiresReview: "true" }));
    expect(f.requiresReview).toBe(true);
  });

  it("?requiresReview=false → boolean false", () => {
    const f = buildTaxCalculationFilters(sp({ requiresReview: "false" }));
    expect(f.requiresReview).toBe(false);
  });

  it("sin requiresReview → undefined (no aplica filtro)", () => {
    const f = buildTaxCalculationFilters(sp({}));
    expect(f.requiresReview).toBeUndefined();
  });

  // ── Parámetros vacíos ────────────────────────────────────────────────────

  it("params solo con espacios se ignoran", () => {
    const f = buildTaxCalculationFilters(sp({ nit: "   ", supplierName: "  " }));
    expect(f.nit).toBeUndefined();
    expect(f.supplierName).toBeUndefined();
  });

  // ── Combinaciones ────────────────────────────────────────────────────────

  it("supplierNit + buyerNit + requiresReview coexisten", () => {
    const f = buildTaxCalculationFilters(
      sp({ supplierNit: "901324042", buyerNit: "900048675", requiresReview: "true" })
    );
    expect(f.supplierNit).toBe("901324042");
    expect(f.buyerNit).toBe("900048675");
    expect(f.requiresReview).toBe(true);
  });
});
