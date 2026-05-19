/**
 * Tests de loadClassifyContext — Task 19.1
 *
 * Verifica que el helper server-side carga correctamente la memoria del tenant
 * desde las tres tablas de Supabase y construye un ClassifyContext válido.
 *
 * Todos los imports son RELATIVOS — vitest no resuelve alias @/.
 */
import { describe, it, expect } from "vitest";
import { loadClassifyContext } from "../../lib/tax/load-classify-context";
import { suggestAccountForLine } from "../../lib/tax/suggest-account";
import type { ClassifyContext } from "../../lib/tax/suggest-account";

// ─── Helpers de mock ────────────────────────────────────────────────────────

/**
 * Crea un chainable mock del Supabase query builder.
 * singleData → lo que devuelve .maybeSingle()
 * arrayData  → lo que devuelve await (para queries sin maybeSingle)
 */
function makeChain(singleData: unknown, arrayData: unknown[]) {
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    order: () => obj,
    limit: () => obj,
    maybeSingle: () => Promise.resolve({ data: singleData, error: null }),
    then(
      onFulfilled?: (v: { data: unknown; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown
    ) {
      return Promise.resolve({ data: arrayData, error: null }).then(onFulfilled, onRejected);
    },
    catch(onRejected?: (e: unknown) => unknown) {
      return Promise.resolve({ data: arrayData, error: null }).catch(onRejected);
    },
    finally(onFinally?: () => void) {
      return Promise.resolve({ data: arrayData, error: null }).finally(onFinally);
    },
  };
  return obj;
}

interface MockConfig {
  supplier_memory?: Record<string, unknown> | null;
  line_memory?: Record<string, unknown> | null;
  patterns?: Record<string, unknown>[];
}

function createMockSupabase(config: MockConfig) {
  return {
    from(table: string) {
      if (table === "tenant_supplier_memory") {
        const d = config.supplier_memory ?? null;
        return makeChain(d, d ? [d] : []);
      }
      if (table === "tenant_tax_classification_memory") {
        const d = config.line_memory ?? null;
        return makeChain(d, d ? [d] : []);
      }
      if (table === "tenant_accounting_patterns") {
        const arr = config.patterns ?? [];
        return makeChain(arr[0] ?? null, arr);
      }
      return makeChain(null, []);
    },
  } as unknown as Parameters<typeof loadClassifyContext>[0]["supabase"];
}

const TENANT_ID = "tenant-abc-123";
const SUPPLIER_NIT = "900123456";

// ─── 1. Memoria de proveedor ────────────────────────────────────────────────

describe("loadClassifyContext — memoria de proveedor", () => {
  it("retorna supplier_memory cuando existe en tenant_supplier_memory", async () => {
    const supabase = createMockSupabase({
      supplier_memory: {
        default_account_code: "6135",
        default_payable_account: "220501",
        default_cost_or_expense: "cost",
        default_retefuente_concept: null,
        default_reteica_city: null,
        default_reteica_kind: null,
        confidence: 0.9,
        manually_confirmed: true,
        actividad_economica: null,
      },
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });

    expect(ctx.supplier_nit).toBe(SUPPLIER_NIT);
    expect(ctx.supplier_memory).not.toBeNull();
    expect(ctx.supplier_memory?.default_account_code).toBe("6135");
    expect(ctx.supplier_memory?.manually_confirmed).toBe(true);
    expect(ctx.supplier_memory?.confidence).toBe(0.9);
  });

  it("resuelve supplier_ciiu desde actividad_economica del proveedor", async () => {
    const supabase = createMockSupabase({
      supplier_memory: {
        default_account_code: null,
        default_payable_account: null,
        default_cost_or_expense: null,
        default_retefuente_concept: null,
        default_reteica_city: null,
        default_reteica_kind: null,
        confidence: 0.5,
        manually_confirmed: false,
        actividad_economica: "5611",
      },
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });

    expect(ctx.supplier_ciiu).toBe("5611");
  });

  it("supplier_ciiu explícito tiene precedencia sobre actividad_economica", async () => {
    const supabase = createMockSupabase({
      supplier_memory: {
        default_account_code: null,
        default_payable_account: null,
        default_cost_or_expense: null,
        default_retefuente_concept: null,
        default_reteica_city: null,
        default_reteica_kind: null,
        confidence: 0,
        manually_confirmed: false,
        actividad_economica: "4711",
      },
    });

    const ctx = await loadClassifyContext({
      supabase,
      tenantId: TENANT_ID,
      supplierNit: SUPPLIER_NIT,
      supplierCiiu: "6201", // explícito
    });

    expect(ctx.supplier_ciiu).toBe("6201"); // debe prevalecer el explícito
  });

  it("sin NIT retorna contexto vacío sin consultar supplier ni line memory", async () => {
    const supabase = createMockSupabase({
      supplier_memory: { default_account_code: "6135", confidence: 0.9, manually_confirmed: true },
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: null });

    expect(ctx.supplier_nit).toBeNull();
    expect(ctx.supplier_memory).toBeNull();
    expect(ctx.line_memory).toBeNull();
  });
});

// ─── 2. Patrones de descripción ────────────────────────────────────────────

describe("loadClassifyContext — patrón de descripción", () => {
  it("retorna line_memory con mayor confianza del proveedor", async () => {
    const supabase = createMockSupabase({
      line_memory: {
        account_code: "5135",
        kind: "service",
        retefuente_concept: "honorarios",
        confidence: 0.75,
      },
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });

    expect(ctx.line_memory).not.toBeNull();
    expect(ctx.line_memory?.account_code).toBe("5135");
    expect(ctx.line_memory?.kind).toBe("service");
    expect(ctx.line_memory?.confidence).toBe(0.75);
  });

  it("line_memory es null cuando no hay patrones para el proveedor", async () => {
    const supabase = createMockSupabase({ line_memory: null });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });

    expect(ctx.line_memory).toBeNull();
  });
});

// ─── 3. Patrones históricos ─────────────────────────────────────────────────

describe("loadClassifyContext — patrones históricos", () => {
  it("retorna accounting_patterns del historial importado", async () => {
    const supabase = createMockSupabase({
      patterns: [
        {
          account_code: "7205",
          account_description: "Materias primas",
          payable_account_code: "220501",
          cost_or_expense: "cost",
          line_kind: "purchase",
          confidence: 0.8,
          usage_count: 15,
        },
        {
          account_code: "5135",
          account_description: "Servicios",
          payable_account_code: null,
          cost_or_expense: "expense",
          line_kind: "service",
          confidence: 0.65,
          usage_count: 5,
        },
      ],
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });

    expect(ctx.accounting_patterns).toHaveLength(2);
    expect(ctx.accounting_patterns[0].account_code).toBe("7205");
    expect(ctx.accounting_patterns[0].usage_count).toBe(15);
    expect(ctx.accounting_patterns[1].account_code).toBe("5135");
  });

  it("sin NIT retorna patrones del tenant completo (sin filtro NIT)", async () => {
    const supabase = createMockSupabase({
      patterns: [
        {
          account_code: "6135",
          account_description: "Costo de ventas",
          payable_account_code: null,
          cost_or_expense: "cost",
          line_kind: "purchase",
          confidence: 0.7,
          usage_count: 30,
        },
      ],
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: null });

    // Sin NIT no filtramos patrones — se devuelven todos los del tenant
    expect(ctx.accounting_patterns).toHaveLength(1);
    expect(ctx.accounting_patterns[0].account_code).toBe("6135");
  });

  it("accounting_patterns vacío cuando no hay historial", async () => {
    const supabase = createMockSupabase({ patterns: [] });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });

    expect(ctx.accounting_patterns).toHaveLength(0);
  });
});

// ─── 4. Integración con el motor de sugerencia ─────────────────────────────

describe("loadClassifyContext → suggestAccountForLine (integración)", () => {
  it("cuenta de memoria manual del proveedor se usa con prioridad máxima", async () => {
    const supabase = createMockSupabase({
      supplier_memory: {
        default_account_code: "7205",
        default_payable_account: "220501",
        default_cost_or_expense: "cost",
        default_retefuente_concept: null,
        default_reteica_city: null,
        default_reteica_kind: null,
        confidence: 0.95,
        manually_confirmed: true,
        actividad_economica: null,
      },
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });
    const suggestion = suggestAccountForLine("purchase", ctx);

    expect(suggestion.account_code).toBe("7205");
    expect(suggestion.memory_source).toBe("manual");
    expect(suggestion.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("sin memoria cae a regla CIIU y NOT retorna 513595", async () => {
    const supabase = createMockSupabase({
      supplier_memory: {
        default_account_code: null,
        default_payable_account: null,
        default_cost_or_expense: null,
        default_retefuente_concept: null,
        default_reteica_city: null,
        default_reteica_kind: null,
        confidence: 0,
        manually_confirmed: false,
        actividad_economica: "5611", // Restaurantes
      },
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });
    const suggestion = suggestAccountForLine("purchase", ctx);

    expect(suggestion.account_code).not.toBe("513595");
    expect(suggestion.memory_source).toBe("rule/ciiu");
  });

  it("contexto completamente vacío devuelve account_code null sin 513595", async () => {
    const supabase = createMockSupabase({});

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID });
    const suggestion = suggestAccountForLine("purchase", ctx);

    expect(suggestion.account_code).toBeNull();
    expect(suggestion.account_code).not.toBe("513595");
  });

  it("cuenta de patrón histórico se usa cuando no hay memoria de proveedor", async () => {
    const supabase = createMockSupabase({
      supplier_memory: null,
      patterns: [
        {
          account_code: "5135",
          account_description: "Servicios",
          payable_account_code: "220501",
          cost_or_expense: "expense",
          line_kind: "service",
          confidence: 0.72,
          usage_count: 8,
        },
      ],
    });

    const ctx = await loadClassifyContext({ supabase, tenantId: TENANT_ID, supplierNit: SUPPLIER_NIT });
    const suggestion = suggestAccountForLine("service", ctx);

    expect(suggestion.account_code).toBe("5135");
    expect(suggestion.memory_source).toBe("history");
  });
});

// ─── 5. Resiliencia — errores de BD no bloquean el flujo ──────────────────

describe("loadClassifyContext — resiliencia", () => {
  it("errores en queries de patterns no propagan excepción", async () => {
    // Mock que lanza en .catch(): simula fallo de BD
    const failingChain: Record<string, unknown> = {
      select: () => failingChain,
      eq: () => failingChain,
      order: () => failingChain,
      limit: () => failingChain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      catch: (onRejected: (e: unknown) => unknown) =>
        Promise.reject(new Error("DB connection failed")).catch(onRejected),
      then(
        onFulfilled?: (v: { data: unknown; error: null }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
      },
    };
    const brokenSupabase = {
      from: () => failingChain,
    } as unknown as Parameters<typeof loadClassifyContext>[0]["supabase"];

    // No debe lanzar excepción
    const ctx: ClassifyContext = await loadClassifyContext({
      supabase: brokenSupabase,
      tenantId: TENANT_ID,
      supplierNit: SUPPLIER_NIT,
    });

    // Debe devolver contexto vacío / parcial
    expect(ctx).toBeDefined();
    expect(ctx.accounting_patterns).toHaveLength(0);
  });
});
