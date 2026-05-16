/**
 * Tipos canónicos para la extracción DIAN UBL 2.1
 *
 * DianExtractedField<T> captura no solo el valor extraído sino también
 * metadatos de trazabilidad: qué fuente lo produjo, confianza y
 * el path XPath/regex que lo localizó.
 */

export type ExtractionSource = "xml" | "pdf" | "inferred" | "not_found";

export interface DianExtractedField<T = string | number | null> {
  value: T;
  source: ExtractionSource;
  confidence: number; // 0..1
  path_or_pattern: string;
}

// ─── Línea de detalle ────────────────────────────────────────────────────────

export interface DianCanonicalInvoiceLine {
  detalle_Nro: DianExtractedField<number>;
  detalle_Codigo: DianExtractedField<string | null>;
  detalle_Descripcion: DianExtractedField<string | null>;
  detalle_UM: DianExtractedField<string | null>;
  detalle_Cantidad: DianExtractedField<number>;
  detalle_Precio_unitario: DianExtractedField<number | null>;
  detalle_Descuento_detalle: DianExtractedField<number | null>;
  detalle_Recargo_detalle: DianExtractedField<number | null>;
  detalle_impuesto_iva: DianExtractedField<number | null>;
  detalle_iva_perc: DianExtractedField<number | null>;
  detalle_impuesto_inc: DianExtractedField<number | null>;
  detalle_inc_perc: DianExtractedField<number | null>;
  detalle_precio_unitario_venta: DianExtractedField<number | null>;
  detalle_total_linea: DianExtractedField<number | null>;
  detalle_base_gravable: DianExtractedField<number | null>;
  detalle_notas: DianExtractedField<string | null>;
  detalle_propiedades_adicionales_json: DianExtractedField<Record<string, unknown>[] | null>;
}

// ─── Factura canónica ─────────────────────────────────────────────────────────

export interface DianCanonicalInvoice {
  // ── Datos del documento ──────────────────────────────────────────────────
  datos_documento_numero_factura: DianExtractedField<string | null>;
  datos_documento_cufe: DianExtractedField<string | null>;
  datos_documento_fecha_emision: DianExtractedField<string | null>;
  datos_documento_hora_emision: DianExtractedField<string | null>;
  datos_documento_fecha_vencimiento: DianExtractedField<string | null>;
  datos_documento_tipo_operacion: DianExtractedField<string | null>;
  datos_documento_tipo_documento: DianExtractedField<string | null>;
  datos_documento_forma_de_pago: DianExtractedField<string | null>;
  datos_documento_medio_de_pago: DianExtractedField<string | null>;
  datos_documento_orden_pedido: DianExtractedField<string | null>;
  datos_documento_fecha_orden_pedido: DianExtractedField<string | null>;

  // ── Emisor / vendedor ────────────────────────────────────────────────────
  datos_emisor_vendedor_razon_social: DianExtractedField<string | null>;
  datos_emisor_vendedor_nombre_comercial: DianExtractedField<string | null>;
  datos_emisor_vendedor_nit_emisor: DianExtractedField<string | null>;
  datos_emisor_vendedor_tipo_documento: DianExtractedField<string | null>;
  datos_emisor_vendedor_tipo_contribuyente: DianExtractedField<string | null>;
  datos_emisor_vendedor_regimen_fiscal: DianExtractedField<string | null>;
  datos_emisor_vendedor_responsabilidad_tributaria: DianExtractedField<string | null>;
  datos_emisor_vendedor_actividad_economica: DianExtractedField<string | null>;
  datos_emisor_vendedor_pais: DianExtractedField<string | null>;
  datos_emisor_vendedor_departamento: DianExtractedField<string | null>;
  datos_emisor_vendedor_municipio_ciudad: DianExtractedField<string | null>;
  datos_emisor_vendedor_direccion: DianExtractedField<string | null>;
  datos_emisor_vendedor_telefono_movil: DianExtractedField<string | null>;
  datos_emisor_vendedor_correo: DianExtractedField<string | null>;

  // ── Adquiriente / comprador ──────────────────────────────────────────────
  datos_adquiriente_comprador_nombre_razon_social: DianExtractedField<string | null>;
  datos_adquiriente_comprador_tipo_documento: DianExtractedField<string | null>;
  datos_adquiriente_comprador_numero_documento: DianExtractedField<string | null>;
  datos_adquiriente_comprador_tipo_contribuyente: DianExtractedField<string | null>;
  datos_adquiriente_comprador_regimen_fiscal: DianExtractedField<string | null>;
  datos_adquiriente_comprador_responsabilidad_tributaria: DianExtractedField<string | null>;
  datos_adquiriente_comprador_pais: DianExtractedField<string | null>;
  datos_adquiriente_comprador_departamento: DianExtractedField<string | null>;
  datos_adquiriente_comprador_municipio_ciudad: DianExtractedField<string | null>;
  datos_adquiriente_comprador_direccion: DianExtractedField<string | null>;
  datos_adquiriente_comprador_telefono_movil: DianExtractedField<string | null>;
  datos_adquiriente_comprador_correo: DianExtractedField<string | null>;

  // ── Detalle de líneas ────────────────────────────────────────────────────
  detalle: DianCanonicalInvoiceLine[];

  // ── Totales ──────────────────────────────────────────────────────────────
  totales_moneda: DianExtractedField<string | null>;
  totales_subtotal: DianExtractedField<number | null>;
  totales_descuento_detalle: DianExtractedField<number | null>;
  totales_recargo_detalle: DianExtractedField<number | null>;
  totales_total_bruto_factura: DianExtractedField<number | null>;
  totales_IVA: DianExtractedField<number | null>;
  totales_INC: DianExtractedField<number | null>;
  totales_bolsas: DianExtractedField<number | null>;
  totales_otros_impuestos: DianExtractedField<number | null>;
  totales_total_impuesto: DianExtractedField<number | null>;
  totales_total_neto_factura: DianExtractedField<number | null>;
  totales_descuento_global: DianExtractedField<number | null>;
  totales_recargo_global: DianExtractedField<number | null>;
  totales_total_factura: DianExtractedField<number | null>;
  totales_anticipos: DianExtractedField<number | null>;
  totales_rete_fuente: DianExtractedField<number | null>;
  totales_rete_iva: DianExtractedField<number | null>;
  totales_rete_ica: DianExtractedField<number | null>;

  // ── Metadatos de extracción ──────────────────────────────────────────────
  source_file_name: string;
  source_file_type: string;
  extraction_source: ExtractionSource;
  extraction_confidence: number;
  extraction_warnings: string[];
  xml_detected_type: string | null;
  xml_is_attached_document: boolean;
  xml_embedded_invoice_found: boolean;
  pdf_layout_detected: string | null;
  parser_version: string;
  source_payload_json: Record<string, unknown> | null;
}

// ─── Helpers de construcción ─────────────────────────────────────────────────

export function xmlField<T>(
  value: T,
  path: string,
  confidence = 0.95
): DianExtractedField<T> {
  return { value, source: "xml", confidence, path_or_pattern: path };
}

export function pdfField<T>(
  value: T,
  pattern: string,
  confidence = 0.70
): DianExtractedField<T> {
  return { value, source: "pdf", confidence, path_or_pattern: pattern };
}

export function notFound<T = null>(): DianExtractedField<T> {
  return {
    value: null as unknown as T,
    source: "not_found",
    confidence: 0,
    path_or_pattern: "",
  };
}

// ─── Constantes DIAN ────────────────────────────────────────────────────────

/** Tabla de forma de pago DIAN UBL 2.1 (cac:PaymentMeans/cbc:ID) */
export const DIAN_FORMA_PAGO: Record<string, string> = {
  "1": "Contado",
  "01": "Contado",
  "2": "Crédito",
  "02": "Crédito",
};

/** Tabla de tipo de documento (InvoiceTypeCode) */
export const DIAN_TIPO_DOCUMENTO: Record<string, string> = {
  "01": "Factura de venta",
  "02": "Factura de exportación",
  "03": "Factura de contingencia",
  "04": "Nota de débito",
  "05": "Nota de crédito",
};

/** Tax scheme IDs DIAN */
export const DIAN_TAX_SCHEME_IVA = ["01"];
export const DIAN_TAX_SCHEME_INC = ["04"];
export const DIAN_TAX_SCHEME_BOLSAS = ["22"];
export const DIAN_TAX_SCHEME_RETE_IVA = ["05"];
export const DIAN_TAX_SCHEME_RETE_FUENTE = ["06"];
export const DIAN_TAX_SCHEME_RETE_ICA = ["07"];
