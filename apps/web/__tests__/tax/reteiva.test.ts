/**
 * Tests: ReteIVA motor tributario
 *
 * REGLA CRÍTICA: IVA = 0 → ReteIVA = 0 (obligatorio)
 * El INC NO es base de ReteIVA.
 */
import { describe, it, expect } from "vitest";
import { getDefaultTaxRulesConfig } from "../../lib/tax/tax-rules-loader";
import { groupReteivaBases } from "../../lib/tax/group-tax-bases";
import { calculateReteiva, totalReteiva } from "../../lib/tax/calculate-reteiva";

describe("ReteIVA — regla fundamental IVA=0", () => {
  const config = getDefaultTaxRulesConfig();

  it("CRÍTICO: IVA = 0 → ReteIVA = 0 (aunque haya INC)", () => {
    const group = groupReteivaBases(0, config.reteiva, [1, 2, 3]);
    calculateReteiva(group, config.reteiva, 0);

    expect(group.applies).toBe(false);
    expect(group.calculated_amount).toBe(0);
    expect(group.base).toBe(0);
    expect(group.reasons.some((r) => r.includes("IVA en cero"))).toBe(true);
  });

  it("IVA = 0 (valor negativo por seguridad) → ReteIVA = 0", () => {
    const group = groupReteivaBases(-100, config.reteiva, []);
    calculateReteiva(group, config.reteiva, -100);

    expect(group.applies).toBe(false);
    expect(group.calculated_amount).toBe(0);
  });

  it("IVA = 1.000.000 → ReteIVA = 150.000 (15%)", () => {
    const group = groupReteivaBases(1_000_000, config.reteiva, [1]);
    calculateReteiva(group, config.reteiva, 1_000_000);

    expect(group.applies).toBe(true);
    expect(group.base).toBe(1_000_000);
    expect(group.rate).toBe(0.15);
    expect(group.calculated_amount).toBe(150_000);
  });

  it("IVA = 500.000 → ReteIVA = 75.000 (15%)", () => {
    const group = groupReteivaBases(500_000, config.reteiva, [1]);
    calculateReteiva(group, config.reteiva, 500_000);

    expect(group.applies).toBe(true);
    expect(group.calculated_amount).toBe(75_000);
  });

  it("totalReteiva devuelve 0 cuando no aplica", () => {
    const group = groupReteivaBases(0, config.reteiva, []);
    calculateReteiva(group, config.reteiva, 0);

    expect(totalReteiva([group])).toBe(0);
  });

  it("Cuenta contable es '236701'", () => {
    const group = groupReteivaBases(1_000_000, config.reteiva, []);
    calculateReteiva(group, config.reteiva, 1_000_000);

    expect(group.account_code).toBe("236701");
  });
});
