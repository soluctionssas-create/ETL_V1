/**
 * Barrel público del módulo lib/dian
 *
 * Exporta la función unificada de extracción y los tipos canónicos.
 * El orden de prioridad para extracción es:
 *   ZIP con XML > ZIP con PDF > XML directo > PDF directo
 */

export type { DianCanonicalInvoice, DianCanonicalInvoiceLine, DianExtractedField, ExtractionSource } from "./dian-canonical-types";
export { extractDianInvoiceFromXml, PARSER_VERSION } from "./extract-dian-xml";
export { extractDianInvoiceFromPdfText, PARSER_VERSION_PDF } from "./extract-dian-pdf";

/**
 * Convierte un DianCanonicalInvoice a los campos planos que usa facturas_dian.
 * Extrae el .value de cada DianExtractedField.
 */
import type { DianCanonicalInvoice } from "./dian-canonical-types";

export function canonicalToFacturaDian(
  canonical: DianCanonicalInvoice,
  batchId: string
): Record<string, unknown> {
  return {
    batch_id: batchId,
    // Documento
    doc_numero_factura: canonical.datos_documento_numero_factura.value,
    doc_fecha_emision: canonical.datos_documento_fecha_emision.value,
    doc_fecha_vencimiento: canonical.datos_documento_fecha_vencimiento.value,
    doc_tipo_operacion: canonical.datos_documento_tipo_operacion.value,
    doc_forma_pago: canonical.datos_documento_forma_de_pago.value ?? "NO_IDENTIFICADO",
    doc_medio_pago: canonical.datos_documento_medio_de_pago.value ?? "TRANSFERENCIA",
    doc_orden_pedido: canonical.datos_documento_orden_pedido.value,
    doc_fecha_orden_pedido: canonical.datos_documento_fecha_orden_pedido.value,
    // Emisor
    emisor_razon_social: canonical.datos_emisor_vendedor_razon_social.value,
    emisor_nombre_comercial: canonical.datos_emisor_vendedor_nombre_comercial.value,
    emisor_nit: canonical.datos_emisor_vendedor_nit_emisor.value,
    emisor_tipo_contribuyente: canonical.datos_emisor_vendedor_tipo_contribuyente.value,
    emisor_regimen_fiscal: canonical.datos_emisor_vendedor_regimen_fiscal.value,
    emisor_responsabilidad_tributaria: canonical.datos_emisor_vendedor_responsabilidad_tributaria.value,
    emisor_actividad_economica: canonical.datos_emisor_vendedor_actividad_economica.value,
    emisor_pais: canonical.datos_emisor_vendedor_pais.value,
    emisor_departamento: canonical.datos_emisor_vendedor_departamento.value,
    emisor_ciudad: canonical.datos_emisor_vendedor_municipio_ciudad.value,
    emisor_direccion: canonical.datos_emisor_vendedor_direccion.value,
    emisor_telefono: canonical.datos_emisor_vendedor_telefono_movil.value,
    emisor_correo: canonical.datos_emisor_vendedor_correo.value,
    // Adquiriente
    adquiriente_nombre_razon_social: canonical.datos_adquiriente_comprador_nombre_razon_social.value,
    adquiriente_tipo_documento: canonical.datos_adquiriente_comprador_tipo_documento.value,
    adquiriente_numero_documento: canonical.datos_adquiriente_comprador_numero_documento.value,
    adquiriente_tipo_contribuyente: canonical.datos_adquiriente_comprador_tipo_contribuyente.value,
    adquiriente_regimen_fiscal: canonical.datos_adquiriente_comprador_regimen_fiscal.value,
    adquiriente_responsabilidad_tributaria: canonical.datos_adquiriente_comprador_responsabilidad_tributaria.value,
    adquiriente_pais: canonical.datos_adquiriente_comprador_pais.value,
    adquiriente_departamento: canonical.datos_adquiriente_comprador_departamento.value,
    adquiriente_ciudad: canonical.datos_adquiriente_comprador_municipio_ciudad.value,
    adquiriente_direccion: canonical.datos_adquiriente_comprador_direccion.value,
    adquiriente_telefono: canonical.datos_adquiriente_comprador_telefono_movil.value,
    adquiriente_correo: canonical.datos_adquiriente_comprador_correo.value,
    // Totales
    tot_moneda: canonical.totales_moneda.value ?? "COP",
    tot_subtotal: canonical.totales_subtotal.value,
    tot_descuento_detalle: canonical.totales_descuento_detalle.value,
    tot_recargo_detalle: canonical.totales_recargo_detalle.value,
    tot_total_bruto_factura: canonical.totales_total_bruto_factura.value,
    tot_iva: canonical.totales_IVA.value,
    tot_inc: canonical.totales_INC.value,
    tot_bolsas: canonical.totales_bolsas.value,
    tot_otros_impuestos: canonical.totales_otros_impuestos.value,
    tot_total_impuesto: canonical.totales_total_impuesto.value,
    tot_total_neto_factura: canonical.totales_total_neto_factura.value,
    tot_descuento_global: canonical.totales_descuento_global.value,
    tot_recargo_global: canonical.totales_recargo_global.value,
    tot_total_factura: canonical.totales_total_factura.value,
    tot_anticipos: canonical.totales_anticipos.value,
    tot_rete_fuente: canonical.totales_rete_fuente.value,
    tot_rete_iva: canonical.totales_rete_iva.value,
    tot_rete_ica: canonical.totales_rete_ica.value,
    // Trazabilidad
    estado: "extraida",
    fuente_archivo: canonical.source_file_type,
    fuente_extraccion: canonical.extraction_source,
    confianza_extraccion: canonical.extraction_confidence,
    version_parser: canonical.parser_version,
    canonical_invoice_json: canonical,
    extraction_warnings_json:
      canonical.extraction_warnings.length > 0
        ? canonical.extraction_warnings
        : null,
    json_crudo: canonical.source_payload_json,
  };
}

/**
 * Convierte las líneas de detalle del canonical a filas de facturas_dian_detalle.
 * Retorna [] si no hay líneas — el llamador decide si eso es un error.
 */
export function canonicalLinesToDetalles(
  canonical: DianCanonicalInvoice
): Record<string, unknown>[] {
  if (canonical.detalle.length === 0) {
    return [];
  }
  // Filtrar líneas completamente vacías (descripción Y total ambos nulos)
  const validLines = canonical.detalle.filter(
    (l) => l.detalle_Descripcion.value != null || l.detalle_total_linea.value != null
  );
  if (validLines.length === 0) return [];
  return validLines.map((line) => ({
    detalle_nro: line.detalle_Nro.value,
    detalle_codigo: line.detalle_Codigo.value,
    detalle_descripcion: line.detalle_Descripcion.value,
    detalle_um: line.detalle_UM.value,
    detalle_cantidad: line.detalle_Cantidad.value,
    detalle_precio_unitario: line.detalle_Precio_unitario.value,
    detalle_descuento: line.detalle_Descuento_detalle.value,
    detalle_recargo: line.detalle_Recargo_detalle.value,
    detalle_impuesto_iva: line.detalle_impuesto_iva.value,
    detalle_porcentaje_iva: line.detalle_iva_perc.value,
    detalle_impuesto_inc: line.detalle_impuesto_inc.value,
    detalle_porcentaje_inc: line.detalle_inc_perc.value,
    detalle_precio_unitario_venta: line.detalle_precio_unitario_venta.value,
    detalle_total_linea: line.detalle_total_linea.value,
    detalle_base_gravable: line.detalle_base_gravable.value,
    detalle_notas: line.detalle_notas.value,
    detalle_propiedades_adicionales_json: line.detalle_propiedades_adicionales_json.value,
  }));
}
