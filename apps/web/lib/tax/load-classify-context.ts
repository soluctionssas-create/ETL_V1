/**
 * Carga el ClassifyContext desde la BD para el motor contable (Task 19.1).
 *
 * Consulta las tres tablas de memoria del tenant:
 *   1. tenant_supplier_memory        → memoria por NIT del proveedor
 *   2. tenant_tax_classification_memory → mejor patrón de descripción
 *   3. tenant_accounting_patterns    → histórico contable importado
 *
 * Este módulo es server-side only. Nunca lo importes desde componentes React.
 * La lógica de sugerencia permanece en suggest-account.ts (motor puro).
 */

import type {
  ClassifyContext,
  SupplierMemory,
  LineMemory,
  AccountingPattern,
} from "./suggest-account";

// Duck-type estructural: acepta cualquier createClient() sin importar sus generics.
// Usar ReturnType<typeof createClient> genera incompatibilidades cuando la llamada
// tiene generics distintos (e.g. createClient<Database>() vs createClient()).
type SupabaseAdminClient = { from(table: string): any }; // intentional structural any

export interface LoadClassifyContextParams {
  supabase: SupabaseAdminClient;
  tenantId: string;
  /** NIT del emisor/proveedor de la factura. */
  supplierNit?: string | null;
  /**
   * Código CIIU del emisor. Opcional: si no se provee aquí, se intenta
   * resolver desde actividad_economica en tenant_supplier_memory.
   */
  supplierCiiu?: string | null;
}

/**
 * Carga el ClassifyContext para una factura específica desde la BD.
 *
 * Siempre devuelve un objeto válido. Si las consultas fallan o el proveedor
 * no tiene memoria, devuelve un contexto vacío (sin datos = motor usa CIIU/kind).
 *
 * Las consultas son independientes y paralelas cuando es posible.
 */
export async function loadClassifyContext(
  params: LoadClassifyContextParams
): Promise<ClassifyContext> {
  const { supabase, tenantId, supplierNit, supplierCiiu } = params;

  let supplierMemory: SupplierMemory | null = null;
  let resolvedCiiu: string | null = supplierCiiu ?? null;
  let lineMemory: LineMemory | null = null;
  let accountingPatterns: AccountingPattern[] = [];

  if (supplierNit) {
    // ── Consultas 1 y 2 en paralelo para mismo NIT ──────────────────────────
    const [supplierResult, lineResult] = await Promise.allSettled([
      // 1. Memoria de proveedor
      supabase
        .from("tenant_supplier_memory")
        .select(
          "default_account_code, default_payable_account, default_cost_or_expense, " +
            "default_retefuente_concept, default_reteica_city, default_reteica_kind, " +
            "confidence, manually_confirmed, actividad_economica"
        )
        .eq("tenant_id", tenantId)
        .eq("supplier_nit", supplierNit)
        .maybeSingle(),

      // 2. Mejor patrón de descripción (mayor confianza para este proveedor)
      supabase
        .from("tenant_tax_classification_memory")
        .select("account_code, kind, retefuente_concept, confidence")
        .eq("tenant_id", tenantId)
        .eq("supplier_nit", supplierNit)
        .order("confidence", { ascending: false })
        .order("times_seen", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // Procesar resultado de supplier memory
    if (supplierResult.status === "fulfilled" && supplierResult.value.data) {
      const row = supplierResult.value.data as Record<string, unknown>;
      supplierMemory = {
        default_account_code: (row.default_account_code as string | null) ?? null,
        default_payable_account: (row.default_payable_account as string | null) ?? null,
        default_cost_or_expense: (row.default_cost_or_expense as string | null) ?? null,
        default_retefuente_concept: (row.default_retefuente_concept as string | null) ?? null,
        default_reteica_city: (row.default_reteica_city as string | null) ?? null,
        default_reteica_kind: (row.default_reteica_kind as string | null) ?? null,
        confidence: (row.confidence as number | null) ?? null,
        manually_confirmed: (row.manually_confirmed as boolean | null) ?? null,
      };
      // Usar actividad_economica como CIIU si no se proveyó externamente
      if (!resolvedCiiu && typeof row.actividad_economica === "string" && row.actividad_economica) {
        resolvedCiiu = row.actividad_economica as string;
      }
    }

    // Procesar resultado de line memory
    if (lineResult.status === "fulfilled" && lineResult.value.data) {
      const row = lineResult.value.data as Record<string, unknown>;
      lineMemory = {
        account_code: (row.account_code as string | null) ?? null,
        kind: (row.kind as string | null) ?? null,
        retefuente_concept: (row.retefuente_concept as string | null) ?? null,
        confidence: (row.confidence as number | null) ?? null,
      };
    }
  }

  // ── 3. Patrones históricos (filtra por NIT si disponible) ──────────────────
  {
    let patternsQuery = supabase
      .from("tenant_accounting_patterns")
      .select(
        "account_code, account_description, payable_account_code, " +
          "cost_or_expense, line_kind, confidence, usage_count"
      )
      .eq("tenant_id", tenantId)
      .order("confidence", { ascending: false })
      .order("usage_count", { ascending: false })
      .limit(20);

    if (supplierNit) {
      patternsQuery = patternsQuery.eq("supplier_nit", supplierNit);
    }

    const patternsResult = await patternsQuery.catch(() => ({ data: null, error: null }));

    if (patternsResult.data) {
      accountingPatterns = (patternsResult.data as Record<string, unknown>[]).map((row) => ({
        account_code: row.account_code as string,
        account_description: (row.account_description as string | null) ?? null,
        payable_account_code: (row.payable_account_code as string | null) ?? null,
        cost_or_expense: (row.cost_or_expense as string | null) ?? null,
        line_kind: (row.line_kind as string | null) ?? null,
        confidence: (row.confidence as number | null) ?? null,
        usage_count: (row.usage_count as number | null) ?? null,
      }));
    }
  }

  return {
    supplier_nit: supplierNit ?? null,
    supplier_ciiu: resolvedCiiu,
    supplier_memory: supplierMemory,
    line_memory: lineMemory,
    accounting_patterns: accountingPatterns,
  };
}
