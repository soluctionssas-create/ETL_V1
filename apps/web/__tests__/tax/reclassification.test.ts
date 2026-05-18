import { describe, it, expect } from "vitest";
import {
  validateInvoiceReclassificationPayload,
  validateLineReclassificationPayload,
  normalizeDescriptionPattern,
  calculateUpdatedConfidence,
  buildAuditRows,
} from "../../lib/tax/reclassification";

// ─── validateInvoiceReclassificationPayload ────────────────────────────────────

describe("validateInvoiceReclassificationPayload", () => {
  it("lanza si reason está ausente", () => {
    expect(() =>
      validateInvoiceReclassificationPayload({ cost_or_expense: "cost" })
    ).toThrow("reason es obligatorio");
  });

  it("lanza si reason tiene menos de 8 caracteres", () => {
    expect(() =>
      validateInvoiceReclassificationPayload({ reason: "corta" })
    ).toThrow("al menos 8 caracteres");
  });

  it("lanza con campos desconocidos", () => {
    expect(() =>
      validateInvoiceReclassificationPayload({
        reason: "justificacion valida",
        hack: true,
      })
    ).toThrow("Campos no permitidos");
  });

  it("lanza si cost_or_expense tiene valor inválido", () => {
    expect(() =>
      validateInvoiceReclassificationPayload({
        reason: "justificacion valida",
        cost_or_expense: "revenue",
      })
    ).toThrow("cost_or_expense");
  });

  it("lanza si account_code es cadena vacía", () => {
    expect(() =>
      validateInvoiceReclassificationPayload({
        reason: "justificacion valida",
        account_code: "   ",
      })
    ).toThrow("account_code no puede ser vacío");
  });

  it("lanza si payable_account_code es cadena vacía", () => {
    expect(() =>
      validateInvoiceReclassificationPayload({
        reason: "justificacion valida",
        payable_account_code: "",
      })
    ).toThrow("payable_account_code no puede ser vacío");
  });

  it("lanza si reteica_kind tiene valor inválido", () => {
    expect(() =>
      validateInvoiceReclassificationPayload({
        reason: "justificacion valida",
        reteica_kind: "mixed",
      })
    ).toThrow("reteica_kind");
  });

  it("acepta payload completo válido", () => {
    const result = validateInvoiceReclassificationPayload({
      cost_or_expense: "cost",
      account_code: "613595",
      payable_account_code: "220505",
      retefuente_concept: "Compras generales declarantes",
      reteica_city: "CALI",
      reteica_kind: "purchase",
      reason: "Proveedor históricamente clasificado como compra de alimentos",
    });
    expect(result.cost_or_expense).toBe("cost");
    expect(result.account_code).toBe("613595");
    expect(result.payable_account_code).toBe("220505");
    expect(result.reteica_kind).toBe("purchase");
    expect(result.reason).toBe(
      "Proveedor históricamente clasificado como compra de alimentos"
    );
  });

  it("acepta cost_or_expense=liability", () => {
    const result = validateInvoiceReclassificationPayload({
      cost_or_expense: "liability",
      reason: "Reclasificado como pasivo",
    });
    expect(result.cost_or_expense).toBe("liability");
  });

  it("acepta mark_as_reviewed=true", () => {
    const result = validateInvoiceReclassificationPayload({
      mark_as_reviewed: true,
      reason: "Revisado y aprobado manualmente",
    });
    expect(result.mark_as_reviewed).toBe(true);
  });

  it("trim de reason", () => {
    const result = validateInvoiceReclassificationPayload({
      reason: "  Justificación con espacios  ",
    });
    expect(result.reason).toBe("Justificación con espacios");
  });
});

// ─── validateLineReclassificationPayload ──────────────────────────────────────

describe("validateLineReclassificationPayload", () => {
  it("acepta kind=purchase con reason válido", () => {
    const result = validateLineReclassificationPayload({
      kind: "purchase",
      reason: "Producto alimenticio, no servicio",
    });
    expect(result.kind).toBe("purchase");
    expect(result.reason).toBe("Producto alimenticio, no servicio");
  });

  it("lanza si kind es inválido", () => {
    expect(() =>
      validateLineReclassificationPayload({
        kind: "goods",
        reason: "justificacion larga ok",
      })
    ).toThrow("kind debe ser uno de");
  });

  it("lanza si reason está ausente", () => {
    expect(() =>
      validateLineReclassificationPayload({ kind: "purchase" })
    ).toThrow("reason es obligatorio");
  });

  it("lanza con campo desconocido", () => {
    expect(() =>
      validateLineReclassificationPayload({
        kind: "purchase",
        reason: "justificacion larga ok",
        campo_extra: true,
      })
    ).toThrow("Campos no permitidos");
  });

  it("acepta exclude_from_withholding=false", () => {
    const result = validateLineReclassificationPayload({
      kind: "purchase",
      exclude_from_withholding: false,
      reason: "Producto alimenticio exento",
    });
    expect(result.exclude_from_withholding).toBe(false);
  });

  it("acepta payload sin kind (solo reason)", () => {
    const result = validateLineReclassificationPayload({
      retefuente_concept: "Honorarios",
      reason: "Corrigiendo concepto de retefuente",
    });
    expect(result.kind).toBeUndefined();
    expect(result.retefuente_concept).toBe("Honorarios");
  });

  it("lanza si reteica_kind tiene valor inválido", () => {
    expect(() =>
      validateLineReclassificationPayload({
        reteica_kind: "purchase_special",
        reason: "justificacion larga ok",
      })
    ).toThrow("reteica_kind");
  });
});

// ─── normalizeDescriptionPattern ──────────────────────────────────────────────

describe("normalizeDescriptionPattern", () => {
  it("convierte a minúsculas", () => {
    expect(normalizeDescriptionPattern("Aceite de Cocina")).toBe(
      "aceite de cocina"
    );
  });

  it("quita tildes", () => {
    expect(normalizeDescriptionPattern("Café tostado")).toBe("cafe tostado");
    expect(normalizeDescriptionPattern("Azúcar morena")).toBe("azucar morena");
    expect(normalizeDescriptionPattern("Jamón ibérico")).toBe("jamon iberico");
  });

  it("quita secuencias de 6+ dígitos consecutivos", () => {
    expect(normalizeDescriptionPattern("Factura 1234567 alimentos")).toBe(
      "factura alimentos"
    );
    expect(normalizeDescriptionPattern("Código 987654321 ítem")).toBe(
      "codigo item"
    );
  });

  it("conserva números cortos (menos de 6 dígitos)", () => {
    expect(normalizeDescriptionPattern("Item 12345 abc")).toContain("12345");
  });

  it("colapsa espacios repetidos y quita espacios extremos", () => {
    expect(normalizeDescriptionPattern("  aceite   de   oliva  ")).toBe(
      "aceite de oliva"
    );
  });

  it("limita a 120 caracteres", () => {
    const long = "descripcion ".repeat(20); // 240 chars
    expect(normalizeDescriptionPattern(long).length).toBeLessThanOrEqual(120);
  });

  it("combina todas las transformaciones", () => {
    const result = normalizeDescriptionPattern(
      "  Azúcar Refinada  Factura-1234567  "
    );
    expect(result).toBe("azucar refinada factura-");
  });
});

// ─── calculateUpdatedConfidence ───────────────────────────────────────────────

describe("calculateUpdatedConfidence", () => {
  it("devuelve 0.55 para times_seen=1", () => {
    expect(calculateUpdatedConfidence(1)).toBeCloseTo(0.55);
  });

  it("escala correctamente para times_seen=5", () => {
    expect(calculateUpdatedConfidence(5)).toBeCloseTo(0.75);
  });

  it("escala correctamente para times_seen=9 (justo antes del cap)", () => {
    expect(calculateUpdatedConfidence(9)).toBeCloseTo(0.95);
  });

  it("no supera 0.95 aunque times_seen sea muy grande", () => {
    expect(calculateUpdatedConfidence(100)).toBe(0.95);
    expect(calculateUpdatedConfidence(1000)).toBe(0.95);
  });

  it("devuelve 0.50 para times_seen=0", () => {
    expect(calculateUpdatedConfidence(0)).toBeCloseTo(0.5);
  });
});

// ─── buildAuditRows ───────────────────────────────────────────────────────────

describe("buildAuditRows", () => {
  const ctx = {
    tenant_id: "tenant-uuid-123",
    calculation_id: "calc-uuid-456",
    supplier_nit: "900123456",
    supplier_name: "Proveedor Test SAS",
    reason: "Reclasificación justificada correctamente",
  };

  it("crea una fila por cada campo modificado", () => {
    const old = { kind: "service", account_code: null };
    const next = { kind: "purchase", account_code: "613595" };
    const rows = buildAuditRows(old, next, ctx);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.field_name === "kind")).toBeTruthy();
    expect(rows.find((r) => r.field_name === "account_code")).toBeTruthy();
  });

  it("no crea fila si old === new", () => {
    const old = { kind: "purchase" };
    const next = { kind: "purchase" };
    const rows = buildAuditRows(old, next, ctx);
    expect(rows).toHaveLength(0);
  });

  it("crea fila cuando old es null y new tiene valor", () => {
    const old = { account_code: null };
    const next = { account_code: "613595" };
    const rows = buildAuditRows(old, next, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].old_value_json).toBeNull();
    expect(rows[0].new_value_json).toBe("613595");
  });

  it("captura old_value_json y new_value_json con tipos correctos", () => {
    const old = { kind: "service" };
    const next = { kind: "purchase" };
    const rows = buildAuditRows(old, next, ctx);
    expect(rows[0].old_value_json).toBe("service");
    expect(rows[0].new_value_json).toBe("purchase");
  });

  it("incluye todo el contexto en cada fila", () => {
    const rows = buildAuditRows({ kind: "service" }, { kind: "purchase" }, ctx);
    expect(rows[0].tenant_id).toBe("tenant-uuid-123");
    expect(rows[0].calculation_id).toBe("calc-uuid-456");
    expect(rows[0].supplier_nit).toBe("900123456");
    expect(rows[0].supplier_name).toBe("Proveedor Test SAS");
    expect(rows[0].reason).toBe("Reclasificación justificada correctamente");
  });

  it("incluye line_id cuando se pasa en el contexto", () => {
    const ctxWithLine = { ...ctx, line_id: "line-001" };
    const rows = buildAuditRows({ kind: "service" }, { kind: "purchase" }, ctxWithLine);
    expect(rows[0].line_id).toBe("line-001");
  });

  it("excluye propiedades opcionales del contexto cuando no se pasan", () => {
    const minCtx = {
      tenant_id: "tenant-xyz",
      reason: "Razon suficientemente larga",
    };
    const rows = buildAuditRows({ kind: "service" }, { kind: "purchase" }, minCtx);
    expect(rows[0].line_id).toBeUndefined();
    expect(rows[0].invoice_id).toBeUndefined();
    expect(rows[0].user_id).toBeUndefined();
  });

  it("trata campos solo en old como cambio a null", () => {
    const old = { kind: "service", extra_field: "valor" };
    const next = { kind: "service" };
    const rows = buildAuditRows(old, next, ctx);
    // kind no cambió; extra_field pasó de "valor" a null
    expect(rows).toHaveLength(1);
    expect(rows[0].field_name).toBe("extra_field");
    expect(rows[0].old_value_json).toBe("valor");
    expect(rows[0].new_value_json).toBeNull();
  });
});
