/**
 * Funciones puras para parsear, normalizar y estructurar los filtros
 * del endpoint GET /api/v1/invoices/batches/:batchId/tax-calculations
 *
 * Separadas del route handler para facilitar pruebas unitarias y
 * reutilización futura.
 */

/** Máximo de registros retornables por petición. */
export const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * Normaliza un NIT colombiano eliminando puntos, guiones y espacios.
 * "900.048.675-1" → "9000486751"
 * "900048675"     → "900048675"
 */
export function normalizeNit(raw: string): string {
  return raw.replace(/[.\-\s]/g, "");
}

/**
 * Normaliza un texto de búsqueda libre:
 *   - Trim de espacios extremos
 *   - Límite de longitud (default 100)
 *   - Elimina caracteres que son comodines en PostgreSQL ILIKE (%, _, \)
 *     para evitar inyección de patrones no intencional.
 */
export function normalizeSearchText(raw: string, maxLen = 100): string {
  return raw.trim().slice(0, maxLen).replace(/[%_\\]/g, "");
}

/** Estructura de filtros ya validados y normalizados. */
export interface TaxCalculationFilters {
  /** Busca coincidencia ILIKE en supplier_nit OR buyer_nit. */
  nit?: string;
  /** Coincidencia exacta en supplier_nit. */
  supplierNit?: string;
  /** Coincidencia exacta en buyer_nit. */
  buyerNit?: string;
  /** Búsqueda parcial ILIKE en supplier_name. */
  supplierName?: string;
  /** Búsqueda parcial ILIKE en buyer_name. */
  buyerName?: string;
  /** Búsqueda parcial ILIKE en supplier_name OR buyer_name. */
  name?: string;
  /** Si está definido, filtra por requires_review = valor. */
  requiresReview?: boolean;
  /** Número de registros a retornar (1–MAX_LIMIT, default 50). */
  limit: number;
  /** Desplazamiento para paginación (≥ 0, default 0). */
  offset: number;
}

/**
 * Parsea los query params de una petición HTTP y retorna un objeto
 * TaxCalculationFilters con valores seguros y normalizados.
 *
 * Reglas:
 *   - limit: clamped a [1, MAX_LIMIT], default DEFAULT_LIMIT
 *   - offset: normalizado a ≥ 0, default 0
 *   - NITs: normalizeNit (quita puntos/guiones/espacios)
 *   - Nombres: normalizeSearchText (trim + escapa comodines SQL)
 *   - Params vacíos o solo espacios se ignoran
 */
export function buildTaxCalculationFilters(
  searchParams: URLSearchParams
): TaxCalculationFilters {
  const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
  const rawOffset = parseInt(searchParams.get("offset") ?? "", 10);

  const limit =
    isNaN(rawLimit) || rawLimit < 1
      ? DEFAULT_LIMIT
      : Math.min(rawLimit, MAX_LIMIT);

  const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const filters: TaxCalculationFilters = { limit, offset };

  const rawNit = searchParams.get("nit")?.trim();
  const rawSupplierNit = searchParams.get("supplierNit")?.trim();
  const rawBuyerNit = searchParams.get("buyerNit")?.trim();

  if (rawNit) filters.nit = normalizeNit(rawNit);
  if (rawSupplierNit) filters.supplierNit = normalizeNit(rawSupplierNit);
  if (rawBuyerNit) filters.buyerNit = normalizeNit(rawBuyerNit);

  const rawName = searchParams.get("name")?.trim();
  const rawSupplierName = searchParams.get("supplierName")?.trim();
  const rawBuyerName = searchParams.get("buyerName")?.trim();

  if (rawName) filters.name = normalizeSearchText(rawName);
  if (rawSupplierName) filters.supplierName = normalizeSearchText(rawSupplierName);
  if (rawBuyerName) filters.buyerName = normalizeSearchText(rawBuyerName);

  const rrParam = searchParams.get("requiresReview");
  if (rrParam !== null) filters.requiresReview = rrParam === "true";

  return filters;
}
