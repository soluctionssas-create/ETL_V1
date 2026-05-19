/**
 * Tests del motor de clasificación contable granular (Task 19)
 *
 * Todos los imports son RELATIVOS — vitest no resuelve alias @/.
 */
import { describe, it, expect } from "vitest";
import {
  suggestAccountForLine,
  enrichLinesWithAccountSuggestions,
  type ClassifyContext,
  type SupplierMemory,
  type AccountingPattern,
} from "../../lib/tax/suggest-account";
import { classifyLine } from "../../lib/tax/classify-line";
import { buildAuditRows } from "../../lib/tax/reclassification";
import type { DianCanonicalInvoiceLine } from "../../lib/dian/dian-canonical-types";

// ─── Helpers de test ────────────────────────────────────────────────────────

function makeCanonicalLine(description: string): DianCanonicalInvoiceLine {
  return {
    detalle_Descripcion: { value: description },
    detalle_Codigo: { value: null },
    detalle_Cantidad: { value: 1 },
    detalle_Precio_unitario: { value: 100000 },
    detalle_total_linea: { value: 100000 },
    detalle_impuesto_iva: { value: 19000 },
    detalle_iva_perc: { value: 0.19 },
    detalle_impuesto_inc: { value: 0 },
    detalle_inc_perc: { value: 0 },
  } as DianCanonicalInvoiceLine;
}

// ─── 1. NUNCA usar 513595 como fallback universal ────────────────────────────

describe("suggestAccountForLine — sin contexto", () => {
  it("no asigna 513595 como fallback cuando no hay memoria ni CIIU", () => {
    const result = suggestAccountForLine("purchase", {});
    expect(result.account_code).not.toBe("513595");
    expect(result.account_code).toBeNull();
    expect(result.memory_source).toBe("rule/kind");
  });

  it("no asigna 513595 para servicio sin contexto", () => {
    const result = suggestAccountForLine("service", {});
    expect(result.account_code).not.toBe("513595");
    expect(result.account_code).toBeNull();
  });

  it("no asigna 513595 para unknown sin contexto", () => {
    const result = suggestAccountForLine("unknown", {});
    expect(result.account_code).not.toBe("513595");
    expect(result.account_code).toBeNull();
    expect(result.memory_source).toBe("default");
  });
});

// ─── 2. Memoria manual confirmada del proveedor ──────────────────────────────

describe("suggestAccountForLine — memoria manual proveedor", () => {
  it("usa la cuenta confirmada manualmente con máxima prioridad", () => {
    const memory: SupplierMemory = {
      default_account_code: "5135",
      default_payable_account: "220501",
      default_cost_or_expense: "expense",
      confidence: 0.95,
      manually_confirmed: true,
    };
    const ctx: ClassifyContext = {
      supplier_nit: "900123456",
      supplier_memory: memory,
    };
    const result = suggestAccountForLine("service", ctx);
    expect(result.account_code).toBe("5135");
    expect(result.memory_source).toBe("manual");
    expect(result.cost_or_expense).toBe("expense");
    expect(result.payable_account_code).toBe("220501");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("usa cuenta de memoria alta confianza aunque no esté manually_confirmed", () => {
    const memory: SupplierMemory = {
      default_account_code: "6135",
      default_cost_or_expense: "cost",
      confidence: 0.85,
      manually_confirmed: false,
    };
    const result = suggestAccountForLine("purchase", { supplier_memory: memory });
    expect(result.account_code).toBe("6135");
    expect(result.memory_source).toBe("manual");
    expect(result.cost_or_expense).toBe("cost");
  });

  it("ignora memoria de baja confianza (<0.7) y cae a siguiente nivel", () => {
    const memory: SupplierMemory = {
      default_account_code: "5135",
      confidence: 0.4,
      manually_confirmed: false,
    };
    // Sin CIIU, debe caer a rule/kind
    const result = suggestAccountForLine("purchase", { supplier_memory: memory });
    // La cuenta de memoria no debe usarse con confianza < 0.7
    expect(result.memory_source).not.toBe("manual");
  });
});

// ─── 3. Patrones históricos contables ───────────────────────────────────────

describe("suggestAccountForLine — patrones históricos", () => {
  it("usa patrón histórico de mayor uso cuando no hay memoria de proveedor", () => {
    const patterns: AccountingPattern[] = [
      {
        account_code: "7205",
        account_description: "Materias primas",
        payable_account_code: "220501",
        cost_or_expense: "cost",
        line_kind: "purchase",
        confidence: 0.75,
        usage_count: 15,
      },
      {
        account_code: "6135",
        account_description: "Costo de ventas",
        cost_or_expense: "cost",
        line_kind: "purchase",
        confidence: 0.6,
        usage_count: 5,
      },
    ];
    const result = suggestAccountForLine("purchase", { accounting_patterns: patterns });
    expect(result.account_code).toBe("7205");
    expect(result.memory_source).toBe("history");
    expect(result.cost_or_expense).toBe("cost");
  });

  it("filtra patrones de bajo confidence (<0.5)", () => {
    const patterns: AccountingPattern[] = [
      {
        account_code: "5195",
        confidence: 0.3,
        usage_count: 2,
        line_kind: "service",
      },
    ];
    const result = suggestAccountForLine("service", { accounting_patterns: patterns });
    expect(result.memory_source).not.toBe("history");
  });
});

// ─── 4. Reglas CIIU ─────────────────────────────────────────────────────────

describe("suggestAccountForLine — reglas CIIU", () => {
  it("CIIU 5611 (restaurante) purchase → 7205 (materias primas)", () => {
    const result = suggestAccountForLine("purchase", { supplier_ciiu: "5611" });
    expect(result.account_code).toBe("7205");
    expect(result.memory_source).toBe("rule/ciiu");
    expect(result.cost_or_expense).toBe("cost");
  });

  it("CIIU 6201 (tecnología) service → 5135 (servicios)", () => {
    const result = suggestAccountForLine("service", { supplier_ciiu: "6201" });
    expect(result.account_code).toBe("5135");
    expect(result.memory_source).toBe("rule/ciiu");
    expect(result.cost_or_expense).toBe("expense");
  });

  it("CIIU 4711 (comercio menor) purchase → 6135 (costo ventas)", () => {
    const result = suggestAccountForLine("purchase", { supplier_ciiu: "4711" });
    expect(result.account_code).toBe("6135");
    expect(result.memory_source).toBe("rule/ciiu");
  });

  it("CIIU desconocido cae a rule/kind", () => {
    const result = suggestAccountForLine("purchase", { supplier_ciiu: "9999" });
    expect(result.memory_source).toBe("rule/kind");
    expect(result.account_code).toBeNull();
  });
});

// ─── 5. Clasificación por kind sin contexto ─────────────────────────────────

describe("suggestAccountForLine — clasificación por kind", () => {
  it("purchase sin contexto → cost_or_expense=cost y account_code=null", () => {
    const result = suggestAccountForLine("purchase", {});
    expect(result.cost_or_expense).toBe("cost");
    expect(result.account_code).toBeNull();
    expect(result.memory_source).toBe("rule/kind");
  });

  it("service sin contexto → cost_or_expense=expense y account_code=null", () => {
    const result = suggestAccountForLine("service", {});
    expect(result.cost_or_expense).toBe("expense");
    expect(result.account_code).toBeNull();
    expect(result.memory_source).toBe("rule/kind");
  });
});

// ─── 6. unknown queda con requires_review=true ───────────────────────────────

describe("classifyLine — unknown con contexto contable", () => {
  it("línea unknown sin context contable → requires_review=true, sin campos contables", () => {
    const line = makeCanonicalLine("XXXXXXX NO KEYWORD 12345");
    const result = classifyLine(line, 0);
    expect(result.kind).toBe("unknown");
    expect(result.requires_review).toBe(true);
    // Sin classifyContext → campos contables NO se agregan al objeto
    expect("suggested_account_code" in result).toBe(false);
  });

  it("línea unknown con classifyContext sin cuenta → requires_review=true", () => {
    const line = makeCanonicalLine("XXXXXXX NO KEYWORD 12345");
    const result = classifyLine(line, 0, undefined, {});
    expect(result.kind).toBe("unknown");
    expect(result.requires_review).toBe(true);
    expect(result.suggested_account_code).toBeNull();
  });
});

// ─── 7. Múltiples líneas con kinds distintos → cuentas diversas ─────────────

describe("enrichLinesWithAccountSuggestions — diversidad de cuentas", () => {
  it("factura con líneas compra+servicio sugiere cuentas distintas", () => {
    const lines = [
      { kind: "purchase" as const, reasons: [], confidence: 0.8 },
      { kind: "service" as const, reasons: [], confidence: 0.8 },
    ];
    // Con CIIU 4711 (comercio): purchase→6135, service→5135
    const ctx: ClassifyContext = { supplier_ciiu: "4711" };
    const enriched = enrichLinesWithAccountSuggestions(lines, ctx);
    expect(enriched[0].suggested_account_code).toBe("6135");
    expect(enriched[1].suggested_account_code).toBe("5135");
    // Las dos cuentas deben ser distintas
    expect(enriched[0].suggested_account_code).not.toBe(enriched[1].suggested_account_code);
  });

  it("todas las líneas tienen al menos uno de: cuenta sugerida o requires_review implícito (null)", () => {
    const lines = [
      { kind: "purchase" as const, reasons: [], confidence: 0.8 },
      { kind: "unknown" as const, reasons: [], confidence: 0.3 },
      { kind: "service" as const, reasons: [], confidence: 0.8 },
    ];
    const ctx: ClassifyContext = { supplier_ciiu: "4711" };
    const enriched = enrichLinesWithAccountSuggestions(lines, ctx);
    for (const line of enriched) {
      // Cada línea tiene un campo definido (puede ser null, pero debe estar presente)
      expect("suggested_account_code" in line).toBe(true);
    }
  });
});

// ─── 8. Razones del motor son auditables ─────────────────────────────────────

describe("suggestAccountForLine — trazabilidad de razones", () => {
  it("incluye razón cuando usa memoria manual", () => {
    const memory: SupplierMemory = {
      default_account_code: "5135",
      confidence: 0.9,
      manually_confirmed: true,
    };
    const result = suggestAccountForLine("service", {
      supplier_nit: "900000001",
      supplier_memory: memory,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toContain("manualmente");
  });

  it("incluye razón CIIU con prefijo y descripción", () => {
    const result = suggestAccountForLine("purchase", { supplier_ciiu: "4711" });
    expect(result.reasons[0]).toContain("CIIU");
    expect(result.reasons[0]).toContain("4711");
  });

  it("incluye razón de revisión cuando es unknown sin contexto", () => {
    const result = suggestAccountForLine("unknown", {});
    expect(result.reasons[0]).toMatch(/revisión/i);
  });
});

// ─── 9. classifyLine integra sugerencia contable ─────────────────────────────

describe("classifyLine — integración con suggest-account", () => {
  it("línea de servicio con CIIU tecnología recibe cuenta 5135", () => {
    const line = makeCanonicalLine("Servicio de desarrollo de software");
    const ctx: ClassifyContext = { supplier_ciiu: "6201" };
    const result = classifyLine(line, 0, undefined, ctx);
    expect(result.kind).toBe("service");
    expect(result.suggested_account_code).toBe("5135");
    expect(result.cost_or_expense).toBe("expense");
    expect(result.memory_source).toBe("rule/ciiu");
  });

  it("línea de compra con CIIU comercio recibe cuenta 6135", () => {
    // Usar descripción con keyword que matchee PURCHASE_KEYWORDS (insumo, compra, producto)
    const line = makeCanonicalLine("Compra de insumos para producción");
    const ctx: ClassifyContext = { supplier_ciiu: "4711" };
    const result = classifyLine(line, 0, undefined, ctx);
    expect(result.kind).toBe("purchase");
    expect(result.suggested_account_code).toBe("6135");
    expect(result.cost_or_expense).toBe("cost");
  });

  it("línea sin classifyContext no incluye campos contables en el objeto", () => {
    const line = makeCanonicalLine("Servicio de consultoría");
    const result = classifyLine(line, 0);
    // Sin classifyContext → campos contables NO se agregan al objeto (undefined real)
    expect("suggested_account_code" in result).toBe(false);
    expect("cost_or_expense" in result).toBe(false);
    expect("memory_source" in result).toBe(false);
  });
});

// ─── 10. buildAuditRows genera filas cuando hay campos nuevos ────────────────

describe("buildAuditRows — Task 19 campos contables", () => {
  it("genera fila de auditoría cuando cambia suggested_account_code", () => {
    const before: Record<string, unknown> = {
      kind: "purchase",
      suggested_account_code: null,
      confidence: 0.5,
    };
    const after: Record<string, unknown> = {
      kind: "purchase",
      suggested_account_code: "6135",
      confidence: 0.8,
    };
    const context = {
      tenant_id: "tenant-001",
      calculation_id: "calc-001",
      line_id: "line-001",
      reason: "Test de campo contable",
    };
    const rows = buildAuditRows(before, after, context);
    // Debe haber al menos una fila de auditoría por el cambio de cuenta
    expect(rows.length).toBeGreaterThan(0);
    const accountRow = rows.find((r) => r.field_name === "suggested_account_code");
    expect(accountRow).toBeDefined();
    expect(accountRow?.new_value_json).toBe("6135");
  });

  it("no genera filas cuando no hay cambios", () => {
    const data: Record<string, unknown> = {
      kind: "service",
      suggested_account_code: "5135",
    };
    const context = {
      tenant_id: "tenant-001",
      reason: "Sin cambios",
    };
    const rows = buildAuditRows(data, { ...data }, context);
    expect(rows.length).toBe(0);
  });
});
