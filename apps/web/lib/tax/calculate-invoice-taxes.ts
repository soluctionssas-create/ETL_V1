/**
 * Orquestador del motor tributario
 *
 * calculateInvoiceTaxes() es el único punto de entrada.
 * Recibe un DianCanonicalInvoice + opciones de tenant y devuelve un
 * InvoiceTaxCalculationResult completamente auditable.
 *
 * Flujo:
 *  1. Clasificar líneas (purchase/service/mixed/unknown)
 *  2. Agrupar bases (ReteFuente, ReteICA, ReteIVA)
 *  3. Calcular cada retención
 *  4. Comparar contra retenciones reportadas en la factura
 *  5. Devolver resultado con flags de revisión
 */

import type { DianCanonicalInvoice } from "../dian/dian-canonical-types";
import type {
  InvoiceTaxCalculationResult,
  TaxBaseGroup,
  TaxEngineOptions,
  TaxRulesConfig,
  WithholdingComparison,
} from "./tax-types";

import { classifyAllLines } from "./classify-line";
import {
  groupRetefuenteBases,
  groupReteicaBases,
  groupReteivaBases,
  normalizeCity,
} from "./group-tax-bases";
import { calculateRetefuente, totalRetefuente } from "./calculate-retefuente";
import { calculateReteica, totalReteica } from "./calculate-reteica";
import { calculateReteiva, totalReteiva } from "./calculate-reteiva";

// ─── Comparador ───────────────────────────────────────────────────────────────

function compareWithholdings(
  tax_type: "retefuente" | "reteica" | "reteiva",
  reported: number,
  calculated: number
): WithholdingComparison {
  const diff = calculated - reported;
  const tolerance = 5; // $5 COP de tolerancia por redondeo

  let status: WithholdingComparison["status"];
  if (Math.abs(diff) <= tolerance) {
    status = "match";
  } else if (calculated === 0 && reported === 0) {
    status = "not_applicable";
  } else {
    status = "difference_requires_review";
  }

  return { tax_type, reported, calculated, difference: diff, status };
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Calcula todos los impuestos y retenciones de una factura DIAN.
 *
 * @param canonical - Factura normalizada del extractor DIAN
 * @param config    - Reglas tributarias cargadas desde los JSON de parametrización
 * @param options   - Ciudad del tenant, NIT comprador, etc.
 */
export function calculateInvoiceTaxes(
  canonical: DianCanonicalInvoice,
  config: TaxRulesConfig,
  options: TaxEngineOptions = {}
): InvoiceTaxCalculationResult {
  const warnings: string[] = [];

  // ── Metadatos de la factura ────────────────────────────────────────────────
  const invoiceNumber = canonical.datos_documento_numero_factura.value ?? "DESCONOCIDA";
  const supplierNit = canonical.datos_emisor_vendedor_nit_emisor.value ?? undefined;
  const supplierName = canonical.datos_emisor_vendedor_razon_social.value ?? undefined;
  const buyerNit = canonical.datos_adquiriente_comprador_numero_documento.value ?? undefined;
  const buyerName = canonical.datos_adquiriente_comprador_nombre_razon_social.value ?? undefined;
  const supplierCity = canonical.datos_emisor_vendedor_municipio_ciudad.value ?? undefined;
  const buyerCity = canonical.datos_adquiriente_comprador_municipio_ciudad.value ?? undefined;

  // ── Totales financieros ────────────────────────────────────────────────────
  const subtotal = canonical.totales_subtotal.value ?? 0;
  const ivaTotal = canonical.totales_IVA.value ?? 0;
  const incTotal = canonical.totales_INC.value ?? 0;
  const totalInvoice = canonical.totales_total_factura.value ?? (subtotal + ivaTotal + incTotal);

  // ── Retenciones reportadas en la factura ──────────────────────────────────
  const reportedRetefuente = canonical.totales_rete_fuente.value ?? 0;
  const reportedReteiva = canonical.totales_rete_iva.value ?? 0;
  const reportedReteica = canonical.totales_rete_ica.value ?? 0;

  // ── Paso 1: Clasificar líneas (con contexto contable si disponible) ─────────
  const classifyContext = options.classify_context ?? undefined;
  const classifiedLines = classifyAllLines(canonical.detalle, config.retefuente, classifyContext);

  // ── Paso 2: Determinar ciudad para ReteICA ────────────────────────────────
  // Prioridad: tenant_city (config explícita) > supplier_city (donde ocurrió la actividad)
  // > buyer_city (ubicación del comprador).
  // Para ReteICA colombiana, la actividad es gravable en el municipio del proveedor.
  const rawCity =
    options.tenant_city ??
    options.supplier_city ??
    supplierCity ??
    options.buyer_city ??
    buyerCity ??
    null;

  const resolvedCity = normalizeCity(rawCity);

  if (!options.tenant_city) {
    if (!resolvedCity) {
      warnings.push("Ciudad no configurada para el tenant — ReteICA requiere revisión manual");
    } else {
      warnings.push(
        `Ciudad ReteICA inferida de la factura (${rawCity} → ${resolvedCity}). Configurar en el tenant para resultado definitivo.`
      );
    }
  }

  // ── Paso 3: Agrupar bases ─────────────────────────────────────────────────
  const retefuenteGroups = groupRetefuenteBases(classifiedLines, config.retefuente);
  const reteicaGroups = groupReteicaBases(classifiedLines, config.reteica, resolvedCity, { addReviewFlag: true });
  const reteIvaGroup = groupReteivaBases(
    ivaTotal,
    config.reteiva,
    classifiedLines.map((l) => l.source_line_number)
  );

  // ── Paso 4: Calcular retenciones ──────────────────────────────────────────
  calculateRetefuente(retefuenteGroups, config.retefuente);
  calculateReteica(reteicaGroups, config.reteica);
  calculateReteiva(reteIvaGroup, config.reteiva, ivaTotal);

  const allGroups: TaxBaseGroup[] = [
    ...retefuenteGroups,
    ...reteicaGroups,
    reteIvaGroup,
  ];

  // ── Paso 5: Totales calculados ────────────────────────────────────────────
  const calcRetefuente = totalRetefuente(allGroups);
  const calcReteica = totalReteica(allGroups);
  const calcReteiva = totalReteiva(allGroups);

  // ── Paso 6: Comparar contra reportado ────────────────────────────────────
  const cmpRetefuente = compareWithholdings("retefuente", reportedRetefuente, calcRetefuente);
  const cmpReteica = compareWithholdings("reteica", reportedReteica, calcReteica);
  const cmpReteiva = compareWithholdings("reteiva", reportedReteiva, calcReteiva);

  const hasSignificantDifference =
    cmpRetefuente.status === "difference_requires_review" ||
    cmpReteica.status === "difference_requires_review" ||
    cmpReteiva.status === "difference_requires_review";

  if (cmpRetefuente.status === "difference_requires_review") {
    warnings.push(
      `ReteFuente: factura reporta ${reportedRetefuente.toFixed(2)}, calculado ${calcRetefuente.toFixed(2)}, diferencia ${cmpRetefuente.difference.toFixed(2)}`
    );
  }
  if (cmpReteica.status === "difference_requires_review") {
    warnings.push(
      `ReteICA: factura reporta ${reportedReteica.toFixed(2)}, calculado ${calcReteica.toFixed(2)}, diferencia ${cmpReteica.difference.toFixed(2)}`
    );
  }
  if (cmpReteiva.status === "difference_requires_review") {
    warnings.push(
      `ReteIVA: factura reporta ${reportedReteiva.toFixed(2)}, calculado ${calcReteiva.toFixed(2)}, diferencia ${cmpReteiva.difference.toFixed(2)}`
    );
  }

  const requiresReview =
    hasSignificantDifference ||
    !resolvedCity ||
    classifiedLines.some((l) => l.requires_review);

  return {
    invoice_number: invoiceNumber,
    supplier_nit: supplierNit,
    supplier_name: supplierName,
    buyer_nit: buyerNit,
    buyer_name: buyerName,
    city: resolvedCity ?? undefined,

    subtotal,
    iva_total: ivaTotal,
    inc_total: incTotal,
    total_invoice: totalInvoice,

    classified_lines: classifiedLines,
    groups: allGroups,

    totals: {
      retefuente: calcRetefuente,
      reteica: calcReteica,
      reteiva: calcReteiva,
    },

    reported_withholdings: {
      retefuente: reportedRetefuente,
      reteica: reportedReteica,
      reteiva: reportedReteiva,
    },

    differences: {
      retefuente: cmpRetefuente.difference,
      reteica: cmpReteica.difference,
      reteiva: cmpReteiva.difference,
    },

    requires_review: requiresReview,
    warnings,
  };
}
