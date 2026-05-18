/**
 * Cargador de reglas tributarias
 *
 * Lee los archivos JSON de parametrización desde la carpeta `data/`.
 * Devuelve los mismos defaults que usa la API /config/tax en caso de error.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { TaxRulesConfig, RetefuenteConfig, ReteicaConfig, ReteIvaConfig } from "./tax-types";

// ─── Resolución de la carpeta data/ ──────────────────────────────────────────

function getDataDirCandidates(): string[] {
  return [
    path.resolve(process.cwd(), "..", "..", "data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "..", "..", "..", "ETL_V1", "data"),
    // Soporte para tests (cwd = apps/web o raíz del monorepo)
    path.resolve(process.cwd(), "..", "..", "..", "data"),
  ];
}

async function resolveDataDir(): Promise<string | null> {
  for (const candidate of getDataDirCandidates()) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // continuar con el siguiente candidato
    }
  }
  return null;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_RETEFUENTE: RetefuenteConfig = {
  uvt_value_cop: 52374,
  default_rule: {
    concept: "Compras generales declarantes",
    normativity: "Art. 401 ET / DUR 1625",
    base_uvt: 10,
    base_cop: 523740,
    rate: 0.025,
    account_code: "236540",
    keywords: [],
  },
  rules: [],
};

const DEFAULT_RETEICA: ReteicaConfig = {
  account_code: "23680101",
  cities: {
    CALI: {
      service: {
        account_code: "23680102",
        base_uvt: 3,
        base_cop: 157122,
        rate: 0.01,
        keywords: [],
      },
      purchase: {
        account_code: "23680101",
        base_uvt: 15,
        base_cop: 785610,
        rate: 0.0077,
        keywords: [],
      },
    },
    BOGOTA: {
      service: {
        account_code: "23680102",
        base_uvt: 4,
        base_cop: 209496,
        rate: 0.0097,
        keywords: [],
      },
      purchase: {
        account_code: "23680101",
        base_uvt: 12,
        base_cop: 628488,
        rate: 0.0066,
        keywords: [],
      },
    },
  },
};

const DEFAULT_RETEIVA: ReteIvaConfig = {
  account_code: "236701",
  fallback_rate: 0.15,
  legal_reference: "Art. 437-1 ET / Decreto 380/1996",
  apply_when: {
    missing_or_zero_reteiva: true,
    iva_greater_than_zero: true,
  },
};

// ─── Carga ────────────────────────────────────────────────────────────────────

let _cachedConfig: TaxRulesConfig | null = null;

/**
 * Carga la configuración tributaria desde archivos JSON.
 * El resultado se cachea en memoria durante la vida del proceso.
 */
export async function loadTaxRulesConfig(forceReload = false): Promise<TaxRulesConfig> {
  if (_cachedConfig && !forceReload) return _cachedConfig;

  const dataDir = await resolveDataDir();

  const retefuente = await readJsonFile<RetefuenteConfig>(
    dataDir ? path.join(dataDir, "retefuente_2026.json") : "",
    DEFAULT_RETEFUENTE
  );
  const reteica = await readJsonFile<ReteicaConfig>(
    dataDir ? path.join(dataDir, "reteica_ciudades.json") : "",
    DEFAULT_RETEICA
  );
  const reteiva = await readJsonFile<ReteIvaConfig>(
    dataDir ? path.join(dataDir, "reteiva_config.json") : "",
    DEFAULT_RETEIVA
  );

  _cachedConfig = { retefuente, reteica, reteiva };
  return _cachedConfig;
}

/**
 * Versión síncrona que devuelve los defaults sin leer disco.
 * Útil en contextos donde no se puede usar await (p.ej., pruebas unitarias puras).
 */
export function getDefaultTaxRulesConfig(): TaxRulesConfig {
  return {
    retefuente: DEFAULT_RETEFUENTE,
    reteica: DEFAULT_RETEICA,
    reteiva: DEFAULT_RETEIVA,
  };
}

/** Invalida el cache (útil en tests o cuando se actualizan reglas en caliente). */
export function clearTaxRulesCache(): void {
  _cachedConfig = null;
}
