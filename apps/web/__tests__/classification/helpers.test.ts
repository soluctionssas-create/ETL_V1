import { describe, expect, it } from "vitest";
import type { TaxCalculation } from "../../lib/api";
import {
  accountDisplay,
  draftFromCalc,
  rowStatus,
} from "../../lib/classification/helpers";

// ─── factory ────────────────────────────────────────────────────────────────

function makeCalc(overrides: Partial<TaxCalculation> = {}): TaxCalculation {
  return {
    id: "calc-001",
    invoice_id: "inv-001",
    factura_dian_id: null,
    invoice_number: "FV-001",
    supplier_nit: "900123456",
    supplier_name: "Proveedor Test SA",
    buyer_nit: "830001234",
    buyer_name: "Empresa SA",
    city: "Bogotá",
    subtotal: 1_000_000,
    iva_total: 190_000,
    inc_total: 0,
    total_invoice: 1_190_000,
    retefuente_calculated: 25_000,
    reteica_calculated: 4_140,
    reteiva_calculated: null,
    retefuente_reported: 25_000,
    reteica_reported: 4_140,
    reteiva_reported: 0,
    retefuente_difference: 0,
    reteica_difference: 0,
    reteiva_difference: 0,
    requires_review: false,
    warnings_json: null,
    result_json: null,
    created_at: "2026-05-18T00:00:00Z",
    ...overrides,
  };
}

// ─── rowStatus ───────────────────────────────────────────────────────────────

describe("rowStatus", () => {
  it("returns ok for a clean calc", () => {
    expect(rowStatus(makeCalc())).toBe("ok");
  });

  it("returns warning when requires_review is true and no differences", () => {
    expect(rowStatus(makeCalc({ requires_review: true }))).toBe("warning");
  });

  it("returns error when retefuente_difference > 1", () => {
    expect(rowStatus(makeCalc({ retefuente_difference: 5 }))).toBe("error");
  });

  it("returns error when reteica_difference is negative > 1", () => {
    expect(rowStatus(makeCalc({ reteica_difference: -3 }))).toBe("error");
  });

  it("returns error when reteiva_difference > 1", () => {
    expect(rowStatus(makeCalc({ reteiva_difference: 2 }))).toBe("error");
  });

  it("error takes precedence over warning", () => {
    expect(
      rowStatus(makeCalc({ requires_review: true, retefuente_difference: 10 })),
    ).toBe("error");
  });

  it("handles null differences gracefully (treats as 0)", () => {
    expect(
      rowStatus(
        makeCalc({
          retefuente_difference: null,
          reteica_difference: null,
          reteiva_difference: null,
        }),
      ),
    ).toBe("ok");
  });

  it("difference of exactly 1 does NOT trigger error", () => {
    expect(rowStatus(makeCalc({ retefuente_difference: 1 }))).toBe("ok");
  });
});

// ─── accountDisplay ──────────────────────────────────────────────────────────

describe("accountDisplay", () => {
  it("returns '–' when no classification data", () => {
    expect(accountDisplay(makeCalc())).toBe("–");
  });

  it("returns manual account_code when set", () => {
    const c = makeCalc({
      result_json: {
        manual_classification: { account_code: "511505" },
      },
    });
    expect(accountDisplay(c)).toBe("511505");
  });

  it("returns 'Servicio' for dominant service lines without manual override", () => {
    const c = makeCalc({
      result_json: {
        classified_lines: [
          {
            line_id: "l1",
            source_line_number: 1,
            description: "Consultoría",
            quantity: 1,
            line_base: 1_000_000,
            iva_amount: 190_000,
            iva_rate: 0.19,
            inc_amount: 0,
            kind: "service",
            confidence: 0.9,
            reasons: [],
            requires_review: false,
          },
        ],
      },
    });
    expect(accountDisplay(c)).toBe("Servicio");
  });

  it("returns 'Compra' for dominant purchase lines without manual override", () => {
    const c = makeCalc({
      result_json: {
        classified_lines: [
          {
            line_id: "l1",
            source_line_number: 1,
            description: "Insumos",
            quantity: 10,
            line_base: 500_000,
            iva_amount: 95_000,
            iva_rate: 0.19,
            inc_amount: 0,
            kind: "purchase",
            confidence: 0.8,
            reasons: [],
            requires_review: false,
          },
        ],
      },
    });
    expect(accountDisplay(c)).toBe("Compra");
  });

  it("never returns hardcoded 513595", () => {
    const label = accountDisplay(makeCalc());
    expect(label).not.toBe("513595");
    expect(label).not.toContain("513595");
  });

  it("manual account_code takes precedence over classified_lines", () => {
    const c = makeCalc({
      result_json: {
        manual_classification: { account_code: "511505" },
        classified_lines: [
          {
            line_id: "l1",
            source_line_number: 1,
            description: "Servicio",
            quantity: 1,
            line_base: 1_000_000,
            iva_amount: 0,
            iva_rate: 0,
            inc_amount: 0,
            kind: "service",
            confidence: 0.95,
            reasons: [],
            requires_review: false,
          },
        ],
      },
    });
    expect(accountDisplay(c)).toBe("511505");
  });
});

// ─── draftFromCalc ───────────────────────────────────────────────────────────

describe("draftFromCalc", () => {
  it("sets cost_or_expense from manual_classification", () => {
    const c = makeCalc({
      result_json: {
        manual_classification: { cost_or_expense: "cost" },
      },
    });
    expect(draftFromCalc(c).cost_or_expense).toBe("cost");
  });

  it("sets account_code from manual_classification", () => {
    const c = makeCalc({
      result_json: {
        manual_classification: { account_code: "511505" },
      },
    });
    expect(draftFromCalc(c).account_code).toBe("511505");
  });

  it("sets payable_account_code from manual_classification", () => {
    const c = makeCalc({
      result_json: {
        manual_classification: { payable_account_code: "220510" },
      },
    });
    expect(draftFromCalc(c).payable_account_code).toBe("220510");
  });

  it("extracts reteica_city from classified_lines when not in manual_classification", () => {
    const c = makeCalc({
      result_json: {
        classified_lines: [
          {
            line_id: "l1",
            source_line_number: 1,
            description: "Servicio",
            quantity: 1,
            line_base: 500_000,
            iva_amount: 0,
            iva_rate: 0,
            inc_amount: 0,
            kind: "service",
            reteica_city: "Medellín",
            confidence: 0.9,
            reasons: [],
            requires_review: false,
          },
        ],
      },
    });
    expect(draftFromCalc(c).reteica_city).toBe("Medellín");
  });

  it("reason is always empty string", () => {
    const c = makeCalc({
      result_json: {
        manual_classification: { reason: "clasificado previamente" },
      },
    });
    expect(draftFromCalc(c).reason).toBe("");
  });

  it("mark_as_reviewed is false for requires_review=true (pending review)", () => {
    const c = makeCalc({ requires_review: true });
    expect(draftFromCalc(c).mark_as_reviewed).toBe(false);
  });

  it("mark_as_reviewed is true for requires_review=false (already validated)", () => {
    const c = makeCalc({ requires_review: false });
    expect(draftFromCalc(c).mark_as_reviewed).toBe(true);
  });

  it("uses default values when result_json is null", () => {
    const d = draftFromCalc(makeCalc({ result_json: null }));
    expect(d.reason).toBe("");
    expect(d.account_code).toBe("");
  });
});
