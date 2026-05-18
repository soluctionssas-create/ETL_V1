/**
 * Extractor XML DIAN UBL 2.1
 *
 * Soporta:
 *  1. XML de Invoice directo (<Invoice> como raíz)
 *  2. AttachedDocument DIAN con Invoice embebido en CDATA dentro de <cbc:Description>
 *
 * Extrae TODOS los campos del esquema canonical DianCanonicalInvoice.
 * Usa solo regex/string-matching — sin dependencia de parser XML externo.
 */

import {
  DianCanonicalInvoice,
  DianCanonicalInvoiceLine,
  DianExtractedField,
  ExtractionSource,
  DIAN_FORMA_PAGO,
  DIAN_TIPO_DOCUMENTO,
  DIAN_TAX_SCHEME_IVA,
  DIAN_TAX_SCHEME_INC,
  DIAN_TAX_SCHEME_BOLSAS,
  DIAN_TAX_SCHEME_RETE_IVA,
  DIAN_TAX_SCHEME_RETE_FUENTE,
  DIAN_TAX_SCHEME_RETE_ICA,
  xmlField,
  notFound,
} from "./dian-canonical-types";

export const PARSER_VERSION = "dian-xml-v1.0.0";

// ─── Primitivas de extracción XML ─────────────────────────────────────────────

/**
 * Extrae el contenido de texto del primer tag coincidente (ignorando namespace).
 * Soporta CDATA y atributos en el tag de apertura.
 */
function tag(source: string, tagNames: string[]): string | null {
  for (const t of tagNames) {
    const re = new RegExp(
      `<(?:[\\w.-]+:)?${t}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${t}>`,
      "i"
    );
    const m = source.match(re);
    if (m?.[1] !== undefined) {
      const cleaned = m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/**
 * Extrae el valor de un atributo de la primera ocurrencia del tag.
 * Ejemplo: extractAttr(xml, "InvoicedQuantity", "unitCode") → "WSD"
 */
function attr(source: string, tagName: string, attrName: string): string | null {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${tagName}\\b[^>]*\\b${attrName}="([^"]*)"`,
    "i"
  );
  const m = source.match(re);
  return m?.[1] ?? null;
}

/**
 * Extrae todas las ocurrencias de un bloque de tags (sección).
 */
function sections(source: string, tagNames: string[]): string[] {
  const results: string[] = [];
  for (const t of tagNames) {
    const re = new RegExp(
      `<(?:[\\w.-]+:)?${t}\\b[^>]*>[\\s\\S]*?<\\/(?:[\\w.-]+:)?${t}>`,
      "gi"
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      results.push(m[0]);
    }
    if (results.length) break;
  }
  return results;
}

/**
 * Extrae la primera sección (bloque de tags).
 */
function section(source: string, tagNames: string[]): string | null {
  const all = sections(source, tagNames);
  return all[0] ?? null;
}

/**
 * Parsea un importe numérico desde texto.
 * Maneja formato colombiano (1.234.567,89) y XML (1234567.89).
 */
function num(value: string | null | undefined): number | null {
  if (!value) return null;
  let s = value.replace(/[^0-9.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    // Formato colombiano: separador de miles = punto, decimal = coma
    s = s.replace(/\./g, "").replace(",", ".");
  }
  // Formato XML/estándar: solo punto decimal
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

/**
 * Normaliza una fecha a ISO date (YYYY-MM-DD).
 * Acepta: YYYY-MM-DD, DD/MM/YYYY, DD MM YYYY
 */
function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  // Ya es YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  // DD/MM/YYYY
  const dmy = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  // DD MM YYYY (espacios)
  const dmySpace = v.match(/^(\d{2})\s+(\d{2})\s+(\d{4})/);
  if (dmySpace) return `${dmySpace[3]}-${dmySpace[2]}-${dmySpace[1]}`;
  return null;
}

// ─── Manejo de AttachedDocument ───────────────────────────────────────────────

interface UnwrapResult {
  xml: string;
  isAttachedDocument: boolean;
  embeddedInvoiceFound: boolean;
}

/**
 * Si el XML es un AttachedDocument DIAN, extrae el Invoice embebido en
 * <cbc:Description><![CDATA[<Invoice>...</Invoice>]]></cbc:Description>
 */
function unwrapAttachedDocument(rawXml: string): UnwrapResult {
  // Detectar AttachedDocument (con o sin namespace fe:)
  const isAttached = /<(?:[\w.-]+:)?AttachedDocument\b/i.test(rawXml);
  if (!isAttached) {
    return { xml: rawXml, isAttachedDocument: false, embeddedInvoiceFound: false };
  }

  // Buscar el bloque CDATA dentro de cbc:Description
  const cdataRe =
    /<(?:[\w.-]+:)?Description\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/(?:[\w.-]+:)?Description>/i;
  const cdataMatch = rawXml.match(cdataRe);
  if (cdataMatch?.[1]) {
    const embedded = cdataMatch[1].trim();
    const hasInvoice = /<(?:[\w.-]+:)?Invoice\b/i.test(embedded);
    return {
      xml: hasInvoice ? embedded : rawXml,
      isAttachedDocument: true,
      embeddedInvoiceFound: hasInvoice,
    };
  }

  return { xml: rawXml, isAttachedDocument: true, embeddedInvoiceFound: false };
}

// ─── Extracción de impuestos ──────────────────────────────────────────────────

interface TaxAccum {
  iva: number;
  inc: number;
  bolsas: number;
  reteIva: number;
  reteFuente: number;
  reteIca: number;
  otrosImpuestos: number;
  totalTax: number;
}

/**
 * Suma TaxAmount para cada TaxSubtotal según el TaxScheme/ID.
 * Procesa TaxTotal (impuestos) y WithholdingTaxTotal (retenciones).
 */
function extractTaxTotals(xml: string): TaxAccum {
  const accum: TaxAccum = {
    iva: 0,
    inc: 0,
    bolsas: 0,
    reteIva: 0,
    reteFuente: 0,
    reteIca: 0,
    otrosImpuestos: 0,
    totalTax: 0,
  };

  // Sumar TaxTotal → TaxSubtotal
  const taxTotalBlocks = sections(xml, ["TaxTotal"]);
  for (const block of taxTotalBlocks) {
    // El TaxAmount a nivel TaxTotal
    const totalAmt = num(tag(block, ["TaxAmount"]));
    if (totalAmt !== null) accum.totalTax += totalAmt;

    const subTotals = sections(block, ["TaxSubtotal"]);
    for (const sub of subTotals) {
      const schemeSection = section(sub, ["TaxScheme"]);
      const schemeId = tag(schemeSection ?? sub, ["ID"])?.trim() ?? "";
      const taxAmt = num(tag(sub, ["TaxAmount"])) ?? 0;

      if (DIAN_TAX_SCHEME_IVA.includes(schemeId)) accum.iva += taxAmt;
      else if (DIAN_TAX_SCHEME_INC.includes(schemeId)) accum.inc += taxAmt;
      else if (DIAN_TAX_SCHEME_BOLSAS.includes(schemeId)) accum.bolsas += taxAmt;
      else if (taxAmt !== 0) accum.otrosImpuestos += taxAmt;
    }
  }

  // Sumar WithholdingTaxTotal → TaxSubtotal
  const withholdingBlocks = sections(xml, ["WithholdingTaxTotal"]);
  for (const block of withholdingBlocks) {
    const subTotals = sections(block, ["TaxSubtotal"]);
    for (const sub of subTotals) {
      const schemeSection = section(sub, ["TaxScheme"]);
      const schemeId = tag(schemeSection ?? sub, ["ID"])?.trim() ?? "";
      const taxAmt = num(tag(sub, ["TaxAmount"])) ?? 0;

      if (DIAN_TAX_SCHEME_RETE_FUENTE.includes(schemeId)) accum.reteFuente += taxAmt;
      else if (DIAN_TAX_SCHEME_RETE_IVA.includes(schemeId)) accum.reteIva += taxAmt;
      else if (DIAN_TAX_SCHEME_RETE_ICA.includes(schemeId)) accum.reteIca += taxAmt;
    }
  }

  return accum;
}

// ─── Extracción de impuestos por línea ───────────────────────────────────────

interface LineTax {
  ivaAmt: number | null;
  ivaPerc: number | null;
  incAmt: number | null;
  incPerc: number | null;
  baseGravable: number | null;
}

function extractLineTax(lineXml: string): LineTax {
  const result: LineTax = {
    ivaAmt: null,
    ivaPerc: null,
    incAmt: null,
    incPerc: null,
    baseGravable: null,
  };

  const subTotals = sections(lineXml, ["TaxSubtotal"]);
  for (const sub of subTotals) {
    const schemeSection = section(sub, ["TaxScheme"]);
    const schemeId = tag(schemeSection ?? sub, ["ID"])?.trim() ?? "";
    const taxAmt = num(tag(sub, ["TaxAmount"]));
    const taxableAmt = num(tag(sub, ["TaxableAmount"]));
    const percent = num(tag(sub, ["Percent"]));

    if (DIAN_TAX_SCHEME_IVA.includes(schemeId)) {
      result.ivaAmt = taxAmt;
      result.ivaPerc = percent;
      result.baseGravable = taxableAmt;
    } else if (DIAN_TAX_SCHEME_INC.includes(schemeId)) {
      result.incAmt = taxAmt;
      result.incPerc = percent;
    }
  }

  return result;
}

// ─── Extracción de información de parte (emisor/adquiriente) ─────────────────

interface PartyInfo {
  registrationName: string | null;
  commercialName: string | null;
  companyId: string | null;
  tipoDocumento: string | null;
  tipoContribuyente: string | null;
  regimenFiscal: string | null;
  responsabilidadTributaria: string | null;
  actividadEconomica: string | null;
  pais: string | null;
  departamento: string | null;
  ciudad: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
}

function extractPartyInfo(partySection: string): PartyInfo {
  // RegistrationName (razón social)
  const registrationName = tag(partySection, ["RegistrationName"]);

  // Nombre comercial — en PartyName/Name
  const partyNameSection = section(partySection, ["PartyName"]);
  const commercialName = tag(partyNameSection ?? "", ["Name"]);

  // CompanyID (NIT) — con attributo schemeID
  const companyId = tag(partySection, ["CompanyID"]);
  const tipoDocumento = attr(partySection, "CompanyID", "schemeID");

  // Tipo de contribuyente — AdditionalAccountID (fuera de Party) o en PartyTaxScheme
  const tipoContribuyente =
    tag(partySection, ["AdditionalAccountID"]) ??
    attr(partySection, "AdditionalAccountID", "listName");

  // Régimen fiscal / responsabilidad — TaxLevelCode, listName="48"
  const regimenFiscal = tag(partySection, ["TaxLevelCode"]);

  // Actividad económica — IndustryClassificationCode
  const actividadEconomica = tag(partySection, ["IndustryClassificationCode"]);

  // Dirección — PhysicalLocation > Address o RegistrationAddress
  const addressSection =
    section(partySection, ["PhysicalLocation"]) ??
    section(partySection, ["RegistrationAddress"]) ??
    section(partySection, ["PostalAddress"]);

  let pais: string | null = null;
  let departamento: string | null = null;
  let ciudad: string | null = null;
  let direccion: string | null = null;

  if (addressSection) {
    const addrBlock = section(addressSection, ["Address"]) ?? addressSection;
    pais = tag(addrBlock, ["IdentificationCode"]) ?? tag(addrBlock, ["CountryIdentificationCode"]);
    departamento = tag(addrBlock, ["CountrySubentity"]);
    ciudad = tag(addrBlock, ["CityName"]);

    // Dirección textual — AddressLine/Line o StreetName
    const addrLineSection = section(addrBlock, ["AddressLine"]);
    direccion =
      tag(addrLineSection ?? addrBlock, ["Line"]) ??
      tag(addrBlock, ["StreetName"]);
  }

  // Contacto
  const contactSection = section(partySection, ["Contact"]);
  const telefono = tag(contactSection ?? partySection, ["Telephone"]);
  const correo = tag(contactSection ?? partySection, ["ElectronicMail"]);

  return {
    registrationName,
    commercialName,
    companyId,
    tipoDocumento,
    tipoContribuyente,
    regimenFiscal,
    responsabilidadTributaria: null, // Codificado en regimenFiscal (TaxLevelCode)
    actividadEconomica,
    pais,
    departamento,
    ciudad,
    direccion,
    telefono,
    correo,
  };
}

// ─── Función principal ───────────────────────────────────────────────────────

export interface ExtractXmlOptions {
  fileName?: string;
}

export function extractDianInvoiceFromXml(
  rawXml: string,
  options: ExtractXmlOptions = {}
): DianCanonicalInvoice {
  const warnings: string[] = [];
  const src: ExtractionSource = "xml";

  const { xml, isAttachedDocument, embeddedInvoiceFound } =
    unwrapAttachedDocument(rawXml);

  if (isAttachedDocument && !embeddedInvoiceFound) {
    warnings.push("AttachedDocument detectado pero Invoice embebido no encontrado; usando XML completo");
  }

  // Detectar tipo de XML
  const xmlDetectedType =
    /<(?:[\w.-]+:)?Invoice\b/i.test(xml)
      ? "Invoice"
      : /<(?:[\w.-]+:)?CreditNote\b/i.test(xml)
      ? "CreditNote"
      : /<(?:[\w.-]+:)?DebitNote\b/i.test(xml)
      ? "DebitNote"
      : "Unknown";

  // Remover bloque UBLExtensions para evitar interferencia en extracción de tags
  const xmlClean = xml.replace(
    /<(?:[\w.-]+:)?UBLExtensions\b[\s\S]*?<\/(?:[\w.-]+:)?UBLExtensions>/gi,
    ""
  );

  // ── Datos del documento ────────────────────────────────────────────────────

  const invoiceNumber = tag(xmlClean, ["ID"]);
  const cufe = tag(xmlClean, ["UUID"]);
  const issueDateRaw = tag(xmlClean, ["IssueDate"]);
  const issueTimeRaw = tag(xmlClean, ["IssueTime"]);
  const dueDateRaw = tag(xmlClean, ["DueDate"]);
  const customizationId = tag(xmlClean, ["CustomizationID"]);
  const invoiceTypeCodeRaw = tag(xmlClean, ["InvoiceTypeCode"]);
  const currency = tag(xmlClean, ["DocumentCurrencyCode"]) ?? "COP";

  // Forma de pago — cac:PaymentMeans/cbc:ID (1=Contado, 2=Crédito)
  const paymentMeansSection = section(xmlClean, ["PaymentMeans"]);
  const paymentMeansId = tag(paymentMeansSection ?? "", ["ID"]);
  const paymentMeansCode = tag(paymentMeansSection ?? "", ["PaymentMeansCode"]);
  const formaDePago = DIAN_FORMA_PAGO[paymentMeansId ?? ""] ?? paymentMeansId ?? null;

  // Orden de pedido
  const orderRefSection = section(xmlClean, ["OrderReference"]);
  const ordenPedido = tag(orderRefSection ?? "", ["ID"]);
  const fechaOrdenPedido = toIsoDate(tag(orderRefSection ?? "", ["IssueDate"]));

  // ── Emisor ─────────────────────────────────────────────────────────────────

  const supplierSection = section(xmlClean, ["AccountingSupplierParty"]);
  const supplierParty = section(supplierSection ?? "", ["Party"]);
  const supplierInfo = extractPartyInfo(
    (supplierSection ?? "") + (supplierParty ?? "")
  );

  if (!supplierInfo.registrationName) {
    warnings.push("emisor.razon_social no encontrada");
  }

  // ── Adquiriente ────────────────────────────────────────────────────────────

  const customerSection = section(xmlClean, ["AccountingCustomerParty"]);
  const customerParty = section(customerSection ?? "", ["Party"]);
  const customerInfo = extractPartyInfo(
    (customerSection ?? "") + (customerParty ?? "")
  );

  if (!customerInfo.registrationName) {
    warnings.push("adquiriente.razon_social no encontrada");
  }

  // ── Totales ────────────────────────────────────────────────────────────────

  const legalMonetary = section(xmlClean, ["LegalMonetaryTotal"]);
  const subtotal = num(tag(legalMonetary ?? "", ["LineExtensionAmount"]));
  const totalBruto = num(tag(legalMonetary ?? "", ["TaxExclusiveAmount"]));
  const totalConIva = num(tag(legalMonetary ?? "", ["TaxInclusiveAmount"]));
  const descuentoGlobal = num(
    tag(legalMonetary ?? "", ["AllowanceTotalAmount"])
  );
  const recargoGlobal = num(tag(legalMonetary ?? "", ["ChargeTotalAmount"]));
  const totalFactura =
    num(tag(legalMonetary ?? "", ["PayableAmount"])) ?? totalConIva ?? subtotal;
  const anticipos = num(tag(legalMonetary ?? "", ["PrepaidAmount"]));

  const taxes = extractTaxTotals(xmlClean);

  // Descuentos/recargos en detalle (AllowanceCharge)
  let descuentoDetalle = 0;
  let recargoDetalle = 0;
  const allowanceCharges = sections(xmlClean, ["AllowanceCharge"]);
  for (const ac of allowanceCharges) {
    const isCharge = tag(ac, ["ChargeIndicator"]) === "true";
    const acAmt = num(tag(ac, ["Amount"])) ?? 0;
    if (isCharge) recargoDetalle += acAmt;
    else descuentoDetalle += acAmt;
  }

  // ── Líneas de detalle ──────────────────────────────────────────────────────

  const invoiceLines = sections(xmlClean, ["InvoiceLine"]);
  const detalle: DianCanonicalInvoiceLine[] = invoiceLines.map((lineXml, i) => {
    const lineNro = num(tag(lineXml, ["ID"])) ?? i + 1;
    const qtyRaw = tag(lineXml, ["InvoicedQuantity"]) ?? "1";
    const unitCode = attr(lineXml, "InvoicedQuantity", "unitCode");
    const lineTotal = num(tag(lineXml, ["LineExtensionAmount"]));

    const itemSection = section(lineXml, ["Item"]);
    const description = tag(itemSection ?? lineXml, ["Description"]);

    const stdIdSection = section(itemSection ?? "", ["StandardItemIdentification", "SellersItemIdentification", "BuyersItemIdentification"]);
    const codigo = tag(stdIdSection ?? "", ["ID"]);

    const priceSection = section(lineXml, ["Price"]);
    const precioUnitario = num(tag(priceSection ?? "", ["PriceAmount"]));

    const lineTax = extractLineTax(lineXml);

    const descuentoLinea = num(
      (() => {
        const acs = sections(lineXml, ["AllowanceCharge"]);
        for (const ac of acs) {
          if (tag(ac, ["ChargeIndicator"]) === "false") return tag(ac, ["Amount"]);
        }
        return null;
      })()
    );

    const notesRaw = sections(lineXml, ["Note"])
      .map((n) => tag(n, ["Note"]) ?? n.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
      .join(" | ");

    return {
      detalle_Nro: xmlField(lineNro, "InvoiceLine/ID"),
      detalle_Codigo: xmlField(codigo ?? null, "StandardItemIdentification/ID"),
      detalle_Descripcion: xmlField(description ?? null, "Item/Description"),
      detalle_UM: xmlField(unitCode ?? null, "InvoicedQuantity/@unitCode"),
      detalle_Cantidad: xmlField(num(qtyRaw) ?? 1, "InvoicedQuantity"),
      detalle_Precio_unitario: xmlField(precioUnitario, "Price/PriceAmount"),
      detalle_Descuento_detalle: xmlField(descuentoLinea, "AllowanceCharge[ChargeIndicator=false]/Amount"),
      detalle_Recargo_detalle: xmlField<number | null>(null, "AllowanceCharge[ChargeIndicator=true]/Amount"),
      detalle_impuesto_iva: xmlField(lineTax.ivaAmt, "TaxSubtotal[01]/TaxAmount"),
      detalle_iva_perc: xmlField(lineTax.ivaPerc, "TaxSubtotal[01]/Percent"),
      detalle_impuesto_inc: xmlField(lineTax.incAmt, "TaxSubtotal[04]/TaxAmount"),
      detalle_inc_perc: xmlField(lineTax.incPerc, "TaxSubtotal[04]/Percent"),
      detalle_precio_unitario_venta: xmlField(precioUnitario, "Price/PriceAmount"),
      detalle_total_linea: xmlField(lineTotal, "LineExtensionAmount"),
      detalle_base_gravable: xmlField(lineTax.baseGravable, "TaxSubtotal/TaxableAmount"),
      detalle_notas: xmlField(notesRaw || null, "Note"),
      detalle_propiedades_adicionales_json: xmlField(null, "n/a"),
    } satisfies DianCanonicalInvoiceLine;
  });

  if (detalle.length === 0) {
    warnings.push("No se encontraron InvoiceLine en el XML");
  }

  // ── Validación de cuadre ───────────────────────────────────────────────────

  if (
    subtotal !== null &&
    totalFactura !== null &&
    Math.abs((subtotal + (taxes.iva ?? 0)) - totalFactura) > 1
  ) {
    warnings.push(
      `Cuadre parcial: subtotal(${subtotal}) + IVA(${taxes.iva}) ≠ total(${totalFactura})`
    );
  }

  // ── Construir objeto canónico ──────────────────────────────────────────────

  const f = <T>(value: T, path: string): DianExtractedField<T> =>
    xmlField(value, path, value !== null ? 0.95 : 0);

  return {
    datos_documento_numero_factura: f(invoiceNumber, "Invoice/ID"),
    datos_documento_cufe: f(cufe, "Invoice/UUID"),
    datos_documento_fecha_emision: f(toIsoDate(issueDateRaw), "IssueDate"),
    datos_documento_hora_emision: f(issueTimeRaw ?? null, "IssueTime"),
    datos_documento_fecha_vencimiento: f(toIsoDate(dueDateRaw), "DueDate"),
    datos_documento_tipo_operacion: f(customizationId ?? null, "CustomizationID"),
    datos_documento_tipo_documento: f(
      DIAN_TIPO_DOCUMENTO[invoiceTypeCodeRaw ?? ""] ?? invoiceTypeCodeRaw ?? null,
      "InvoiceTypeCode"
    ),
    datos_documento_forma_de_pago: f(formaDePago, "PaymentMeans/ID"),
    datos_documento_medio_de_pago: f(paymentMeansCode ?? null, "PaymentMeans/PaymentMeansCode"),
    datos_documento_orden_pedido: f(ordenPedido ?? null, "OrderReference/ID"),
    datos_documento_fecha_orden_pedido: f(fechaOrdenPedido, "OrderReference/IssueDate"),

    datos_emisor_vendedor_razon_social: f(supplierInfo.registrationName, "AccountingSupplierParty//RegistrationName"),
    datos_emisor_vendedor_nombre_comercial: f(supplierInfo.commercialName ?? null, "AccountingSupplierParty//PartyName/Name"),
    datos_emisor_vendedor_nit_emisor: f(supplierInfo.companyId, "AccountingSupplierParty//CompanyID"),
    datos_emisor_vendedor_tipo_documento: f(supplierInfo.tipoDocumento ?? null, "AccountingSupplierParty//CompanyID/@schemeID"),
    datos_emisor_vendedor_tipo_contribuyente: f(supplierInfo.tipoContribuyente ?? null, "AccountingSupplierParty//AdditionalAccountID"),
    datos_emisor_vendedor_regimen_fiscal: f(supplierInfo.regimenFiscal ?? null, "AccountingSupplierParty//TaxLevelCode"),
    datos_emisor_vendedor_responsabilidad_tributaria: notFound(),
    datos_emisor_vendedor_actividad_economica: f(supplierInfo.actividadEconomica ?? null, "AccountingSupplierParty//IndustryClassificationCode"),
    datos_emisor_vendedor_pais: f(supplierInfo.pais ?? null, "AccountingSupplierParty//Address/Country/IdentificationCode"),
    datos_emisor_vendedor_departamento: f(supplierInfo.departamento ?? null, "AccountingSupplierParty//Address/CountrySubentity"),
    datos_emisor_vendedor_municipio_ciudad: f(supplierInfo.ciudad ?? null, "AccountingSupplierParty//Address/CityName"),
    datos_emisor_vendedor_direccion: f(supplierInfo.direccion ?? null, "AccountingSupplierParty//AddressLine/Line"),
    datos_emisor_vendedor_telefono_movil: f(supplierInfo.telefono ?? null, "AccountingSupplierParty//Contact/Telephone"),
    datos_emisor_vendedor_correo: f(supplierInfo.correo ?? null, "AccountingSupplierParty//Contact/ElectronicMail"),

    datos_adquiriente_comprador_nombre_razon_social: f(customerInfo.registrationName, "AccountingCustomerParty//RegistrationName"),
    datos_adquiriente_comprador_tipo_documento: f(customerInfo.tipoDocumento ?? null, "AccountingCustomerParty//CompanyID/@schemeID"),
    datos_adquiriente_comprador_numero_documento: f(customerInfo.companyId, "AccountingCustomerParty//CompanyID"),
    datos_adquiriente_comprador_tipo_contribuyente: f(customerInfo.tipoContribuyente ?? null, "AccountingCustomerParty//AdditionalAccountID"),
    datos_adquiriente_comprador_regimen_fiscal: f(customerInfo.regimenFiscal ?? null, "AccountingCustomerParty//TaxLevelCode"),
    datos_adquiriente_comprador_responsabilidad_tributaria: notFound(),
    datos_adquiriente_comprador_pais: f(customerInfo.pais ?? null, "AccountingCustomerParty//Address/Country/IdentificationCode"),
    datos_adquiriente_comprador_departamento: f(customerInfo.departamento ?? null, "AccountingCustomerParty//Address/CountrySubentity"),
    datos_adquiriente_comprador_municipio_ciudad: f(customerInfo.ciudad ?? null, "AccountingCustomerParty//Address/CityName"),
    datos_adquiriente_comprador_direccion: f(customerInfo.direccion ?? null, "AccountingCustomerParty//AddressLine/Line"),
    datos_adquiriente_comprador_telefono_movil: f(customerInfo.telefono ?? null, "AccountingCustomerParty//Contact/Telephone"),
    datos_adquiriente_comprador_correo: f(customerInfo.correo ?? null, "AccountingCustomerParty//Contact/ElectronicMail"),

    detalle,

    totales_moneda: f(currency, "DocumentCurrencyCode"),
    totales_subtotal: f(subtotal, "LegalMonetaryTotal/LineExtensionAmount"),
    totales_descuento_detalle: f(descuentoDetalle > 0 ? descuentoDetalle : null, "AllowanceCharge[false]/Amount"),
    totales_recargo_detalle: f(recargoDetalle > 0 ? recargoDetalle : null, "AllowanceCharge[true]/Amount"),
    totales_total_bruto_factura: f(totalBruto ?? subtotal, "LegalMonetaryTotal/TaxExclusiveAmount"),
    totales_IVA: f(taxes.iva > 0 ? taxes.iva : 0, "TaxTotal[01]/TaxAmount"),
    totales_INC: f(taxes.inc > 0 ? taxes.inc : 0, "TaxTotal[04]/TaxAmount"),
    totales_bolsas: f(taxes.bolsas > 0 ? taxes.bolsas : null, "TaxTotal[22]/TaxAmount"),
    totales_otros_impuestos: f(taxes.otrosImpuestos > 0 ? taxes.otrosImpuestos : null, "TaxTotal[other]/TaxAmount"),
    totales_total_impuesto: f(taxes.totalTax > 0 ? taxes.totalTax : 0, "TaxTotal/TaxAmount"),
    totales_total_neto_factura: f(totalConIva ?? totalFactura, "LegalMonetaryTotal/TaxInclusiveAmount"),
    totales_descuento_global: f(descuentoGlobal, "LegalMonetaryTotal/AllowanceTotalAmount"),
    totales_recargo_global: f(recargoGlobal, "LegalMonetaryTotal/ChargeTotalAmount"),
    totales_total_factura: f(totalFactura, "LegalMonetaryTotal/PayableAmount"),
    totales_anticipos: f(anticipos, "LegalMonetaryTotal/PrepaidAmount"),
    totales_rete_fuente: f(taxes.reteFuente > 0 ? taxes.reteFuente : null, "WithholdingTaxTotal[06]/TaxAmount"),
    totales_rete_iva: f(taxes.reteIva > 0 ? taxes.reteIva : null, "WithholdingTaxTotal[05]/TaxAmount"),
    totales_rete_ica: f(taxes.reteIca > 0 ? taxes.reteIca : null, "WithholdingTaxTotal[07]/TaxAmount"),

    source_file_name: options.fileName ?? "unknown.xml",
    source_file_type: "xml",
    extraction_source: src,
    extraction_confidence: warnings.length === 0 ? 0.95 : 0.80,
    extraction_warnings: warnings,
    xml_detected_type: xmlDetectedType,
    xml_is_attached_document: isAttachedDocument,
    xml_embedded_invoice_found: embeddedInvoiceFound,
    pdf_layout_detected: null,
    parser_version: PARSER_VERSION,
    source_payload_json: null,
  };
}
