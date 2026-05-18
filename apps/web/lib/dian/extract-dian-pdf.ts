/**
 * Extractor PDF DIAN
 *
 * Usa la salida de texto de pdf-parse (array de líneas) para extraer
 * la información estructurada de una factura DIAN.
 *
 * Estrategia:
 *  1. Detectar bloques semánticos: encabezado, emisor, adquiriente,
 *     tabla de detalle, totales.
 *  2. Solo extraer ítems dentro del bloque de detalle Y que cumplan
 *     el patrón completo (descripción + cantidad + precio + total).
 *  3. Marcado de baja confianza para campos no encontrados.
 *  4. Advertencias cuando los totales no cuadran.
 */

import {
  DianCanonicalInvoice,
  DianCanonicalInvoiceLine,
  DIAN_FORMA_PAGO,
  pdfField,
  notFound,
} from "./dian-canonical-types";

export const PARSER_VERSION_PDF = "dian-pdf-v1.0.0";

// ─── Normalización de números ─────────────────────────────────────────────────

/**
 * Parsea un monto en formato colombiano o estándar.
 * 3.800.000  → 3800000
 * 3.800.000,00 → 3800000
 * 0,00       → 0
 */
function parseAmount(s: string): number | null {
  if (!s) return null;
  let v = s.replace(/[^0-9.,]/g, "");
  if (!v) return null;
  if (v.includes(",")) {
    v = v.replace(/\./g, "").replace(",", ".");
  } else {
    // 3.800.000 (thousands only, no decimal comma)
    const dotCount = (v.match(/\./g) ?? []).length;
    if (dotCount > 1) v = v.replace(/\./g, "");
    else if (dotCount === 1) {
      // Podría ser miles (3.800) o decimal (3.80)
      const parts = v.split(".");
      if (parts[1].length === 3) v = v.replace(".", ""); // miles
      // si tiene 2 decimales, lo dejamos como punto decimal
    }
  }
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

/**
 * Normaliza una fecha a ISO date (YYYY-MM-DD).
 * Acepta: DD/MM/YYYY, DD-MM-YYYY, DD MM YYYY
 */
function parsePdfDate(s: string | null): string | null {
  if (!s) return null;
  const v = s.trim();
  const re =
    /(\d{1,2})[\/\-\s](\d{1,2})[\/\-\s](\d{4})/;
  const m = v.match(re);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const yr = m[3];
    return `${yr}-${mo}-${d}`;
  }
  return null;
}

// ─── Detección de NIT ─────────────────────────────────────────────────────────

/**
 * Extrae NITs (NIT, CC, CE, PA) de un bloque de texto.
 * Busca el patrón contextual: "NIT: XXXXXXXXX" o "800123456-1"
 */
function extractNitsFromBlock(block: string): string[] {
  const results: string[] = [];

  // Patrón NIT con etiqueta
  const labeledRe = /(?:NIT|Nit)\s*[:.]?\s*(\d{6,12}(?:-\d)?)/g;
  let m: RegExpExecArray | null;
  while ((m = labeledRe.exec(block)) !== null) {
    results.push(m[1].replace(/-\d$/, "").trim());
  }
  if (results.length) return results;

  // Patrón solo número de 9 dígitos sin etiqueta
  const bareRe = /\b(\d{8,10})-?(\d)\b/g;
  while ((m = bareRe.exec(block)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

/**
 * Extrae un nombre de empresa de una línea de texto.
 * Busca patrones con S.A., S.A.S., LTDA, S.C.A., etc.
 * O texto en MAYÚSCULAS de al menos 4 caracteres seguido de siglas.
 */
function extractCompanyName(lines: string[]): string | null {
  const legalSuffixRe =
    /\b(S\.A\.S\.?|S\.A\.?|LTDA\.?|S\.C\.A\.?|E\.U\.?|S\.A\.S\b|SAS\b|LTDA\b|SA\b)\s*[.,]?\s*$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 4) continue;
    // Línea con sufijo legal
    if (legalSuffixRe.test(trimmed)) {
      // Filtrar líneas que son solo datos de contacto
      if (!/\d{3,}|@|http/.test(trimmed)) return trimmed;
    }
  }

  // Fallback: primera línea en MAYÚSCULAS de ≥10 caracteres
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length >= 10 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]{4,}/.test(trimmed) &&
      !/\d{6,}/.test(trimmed)
    ) {
      return trimmed;
    }
  }

  return null;
}

// ─── Detección de bloques semánticos ─────────────────────────────────────────

type BlockLabel =
  | "header"
  | "emisor"
  | "adquiriente"
  | "detail_header"
  | "detail"
  | "totals"
  | "unknown";

interface TextBlock {
  label: BlockLabel;
  lines: string[];
  startIndex: number;
}

const DETAIL_HEADER_KEYWORDS = [
  /cantidad|qty|cant\./i,
  /descripci[oó]n|description/i,
  /precio|valor\s+unit|p\.u\.|v\.u\./i,
  /total|importe/i,
];

const TOTALS_KEYWORDS = [
  /subtotal|sub\s*total/i,
  /iva\s*[\d%]|impuesto|tax/i,
  /total\s+(a\s+pagar|factura|neto)|valor\s+total/i,
];

const EMISOR_KEYWORDS = /vendedor|emisor|proveedor|supplier|razón\s*social.*nit|nit.*vendor/i;
const ADQUIRIENTE_KEYWORDS = /comprador|adquiriente|cliente|customer|facturar\s+a/i;

function detectBlocks(lines: string[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  let currentLabel: BlockLabel = "header";
  let currentLines: string[] = [];
  let currentStart = 0;
  let inDetailBody = false;

  const flush = (nextLabel: BlockLabel, idx: number) => {
    if (currentLines.length > 0) {
      blocks.push({ label: currentLabel, lines: [...currentLines], startIndex: currentStart });
    }
    currentLabel = nextLabel;
    currentLines = [];
    currentStart = idx;
    inDetailBody = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detectar inicio de tabla de totales
    if (TOTALS_KEYWORDS.some((re) => re.test(line)) && (currentLabel as string) !== "totals") {
      flush("totals", i);
      currentLines.push(line);
      continue;
    }

    // Detectar cabecera de tabla de detalle
    const headerScore = DETAIL_HEADER_KEYWORDS.filter((re) => re.test(line)).length;
    if (headerScore >= 2 && (currentLabel as string) !== "detail" && (currentLabel as string) !== "detail_header") {
      flush("detail_header", i);
      currentLines.push(line);
      inDetailBody = false;
      continue;
    }

    if ((currentLabel as string) === "detail_header") {
      // La siguiente línea con datos comienza el cuerpo del detalle
      if (line && headerScore < 2) {
        flush("detail", i);
        inDetailBody = true;
        currentLines.push(line);
        continue;
      }
    }

    // Bloque emisor/adquiriente
    if (EMISOR_KEYWORDS.test(line) && (currentLabel as string) === "header") {
      flush("emisor", i);
      currentLines.push(line);
      continue;
    }
    if (ADQUIRIENTE_KEYWORDS.test(line)) {
      flush("adquiriente", i);
      currentLines.push(line);
      continue;
    }

    currentLines.push(line);
  }

  // Último bloque
  if (currentLines.length > 0) {
    blocks.push({ label: currentLabel, lines: currentLines, startIndex: currentStart });
  }

  return blocks;
}

// ─── Extracción de ítems del bloque de detalle ────────────────────────────────

/**
 * Patrón robusto para ítems: requiere al menos cantidad + precio + total.
 * Evita capturar líneas de texto puro o subtotales.
 *
 * Grupos: 1=nro? 2=descripcion 3=um? 4=cantidad 5=precio_unit 6=descuento? 7=total_linea
 */
const ITEM_AMOUNT_RE = /\b\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?\b/g;

function countAmountsInLine(line: string): number {
  const m = line.match(/\b\d{1,3}(?:[.]\d{3})*(?:,\d{1,2})?\b|\b\d{4,}\b/g);
  return m?.length ?? 0;
}

const ITEM_LINE_RE =
  /^(\d+)?\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s\-\/.#&]+?)\s+([\w]{2,6})?\s+(\d[\d.,]*)\s+(\d[\d.,]*)\s+(\d[\d.,]*)(?:\s+(\d[\d.,]*))?/;

const TOTALS_EXCLUSION_RE =
  /\b(subtotal|descuento|recargo|iva|inc|rete|retefuente|reteiva|impuesto|total|cufe|nit|fecha|plazo|vencimiento|orden|pagad[oa]|anticipo)\b/i;

// ─── Parser DIAN "columnas concatenadas" ──────────────────────────────────────
// Formato donde todas las columnas de la tabla aparecen concatenadas sin
// separadores visibles: {nro}{code}{descripcion}{UM:2d}{cant}{precio}...{total}
// Separación descripción↔UM mediante lookahead: UM(2d) + qty en formato N,NN.
// Solo capturamos grupos 1-6; el precio (col "Precio unitario") = línea total.
const DIAN_CONCAT_RE =
  /^(\d{1,4})(\d{6,12})([A-Za-zÁÉÍÓÚáéíóúÑñ][A-Za-zÁÉÍÓÚáéíóúÑñ\s\-\/.#&]*?)(?=\d{2}\d{1,5},\d{2})(\d{2})(\d{1,5},\d{2})([\d.]+,\d{2})/;

/**
 * Pre-procesa líneas del bloque de detalle para manejar el formato DIAN de
 * "columnas concatenadas". Gestiona 3 tipos de ítems multi-línea causados
 * por saltos de página en el PDF:
 *   Tipo A – línea tiene solo nro+código; descripción y números en líneas siguientes.
 *   Tipo B – línea tiene nro+código+desc+UM+cant pero precios están cortados.
 *   Tipo C – variante de B con diferente punto de corte.
 */
function mergeConcatenatedItemLines(rawLines: string[]): string[] {
  const NOISE_LINE_RE =
    /^\$+$|^Hoja\s+\d|^Nro\.|^Código|^Descripci|^Descuentos|^Datos\s+Totales|^Subtotal|^IVA|^INC|^Total|^Valores|^RETENCIONES|^Rete|^MONEDA|^TASA|^PDF|^XML|^Número|^Rango|^Vigencia/i;
  const ITEM_START_RE = /^\d{1,4}\d{6,12}/;
  const ITEM_START_NO_TAIL_RE = /^\d{1,4}\d{6,12}$/;
  const NUMBERS_ONLY_RE = /^[\d.,\s]+$/;
  const UM_QTY_START_RE = /^\d{2}\d{1,5},\d{2}/;

  const merged: string[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i].trim();

    if (!line || NOISE_LINE_RE.test(line)) {
      i++;
      continue;
    }

    // Tipo A: nro+código solamente (sin descripción ni números en la misma línea)
    if (ITEM_START_NO_TAIL_RE.test(line)) {
      const parts: string[] = [line];
      i++;
      while (i < rawLines.length) {
        const next = rawLines[i].trim();
        if (!next || /^\$+$/.test(next)) { i++; continue; }
        if (ITEM_START_RE.test(next)) break;
        if (NOISE_LINE_RE.test(next)) break;
        if (UM_QTY_START_RE.test(next)) {
          parts.push(next);
          i++;
          break;
        }
        if (/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(next)) {
          parts.push(next);
          i++;
          continue;
        }
        break;
      }
      if (parts.length >= 2) {
        const nroCode = parts[0];
        const numbersLine = parts[parts.length - 1];
        const descParts = parts.slice(1, parts.length - 1);
        merged.push(nroCode + descParts.join("") + numbersLine);
      } else {
        merged.push(line);
      }
      continue;
    }

    // Línea ya completa: no requiere merging
    if (DIAN_CONCAT_RE.test(line)) {
      merged.push(line);
      i++;
      continue;
    }

    // Tipo B/C: ítem con nro+código+desc pero precios cortados por salto de página
    if (ITEM_START_RE.test(line)) {
      const parts: string[] = [line];
      i++;
      while (i < rawLines.length) {
        const next = rawLines[i].trim();
        if (!next || next === "  ") { i++; continue; }
        if (/^\$+$/.test(next)) break;
        if (ITEM_START_RE.test(next)) break;
        if (NOISE_LINE_RE.test(next)) break;
        if (NUMBERS_ONLY_RE.test(next)) {
          parts.push(next);
          i++;
          continue;
        }
        break;
      }
      merged.push(parts.join(""));
      continue;
    }

    merged.push(line);
    i++;
  }

  return merged;
}

/**
 * Intenta parsear ítems en formato DIAN "columnas concatenadas".
 * Devuelve array vacío si el formato no aplica (fallback al parser genérico).
 */
function parseConcatenatedDianItems(rawLines: string[]): Array<{
  nro: number;
  codigo: string | null;
  descripcion: string | null;
  um: string | null;
  cantidad: number;
  precioUnitario: number | null;
  descuento: number | null;
  total: number | null;
}> {
  const processedLines = mergeConcatenatedItemLines(rawLines);
  const items: ReturnType<typeof parseConcatenatedDianItems> = [];

  for (const line of processedLines) {
    const m = DIAN_CONCAT_RE.exec(line);
    if (!m) continue;

    items.push({
      nro: parseInt(m[1], 10),
      codigo: m[2] || null,
      descripcion: m[3].trim() || null,
      um: m[4] || null,
      cantidad: parseAmount(m[5]) ?? 1,
      precioUnitario: parseAmount(m[6]),
      descuento: null,
      // En el formato DIAN concatenado, la columna "Precio unitario" es
      // el total de la línea (precio × cantidad). No hay columna separada de total.
      total: parseAmount(m[6]),
    });
  }

  return items;
}

function extractDetailLines(detailBlock: string[]): Array<{
  nro: number;
  codigo: string | null;
  descripcion: string | null;
  um: string | null;
  cantidad: number;
  precioUnitario: number | null;
  descuento: number | null;
  total: number | null;
}> {
  const items: ReturnType<typeof extractDetailLines> = [];
  let lineCounter = 0;

  for (const line of detailBlock) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Excluir líneas de totales, encabezados o etiquetas
    if (TOTALS_EXCLUSION_RE.test(trimmed)) continue;

    const amountCount = countAmountsInLine(trimmed);
    // Necesitamos al menos 2 valores numéricos (cantidad + precio, o precio + total)
    if (amountCount < 2) continue;

    // Intentar parseo estructurado
    const m = ITEM_LINE_RE.exec(trimmed);
    if (m) {
      lineCounter++;
      const nro = m[1] ? parseInt(m[1]) : lineCounter;
      const rawDesc = m[2].trim();
      const rawUm = m[3] ?? null;
      const qty = parseAmount(m[4]) ?? 1;
      const pu = parseAmount(m[5]);
      const col6 = parseAmount(m[6]);
      const col7 = m[7] ? parseAmount(m[7]) : null;

      // Determinar si col6 es descuento o total
      let descuento: number | null = null;
      let total: number | null = null;
      if (col7 !== null) {
        descuento = col6;
        total = col7;
      } else {
        total = col6;
      }

      items.push({
        nro,
        codigo: null,
        descripcion: rawDesc || null,
        um: rawUm,
        cantidad: qty,
        precioUnitario: pu,
        descuento,
        total,
      });
      continue;
    }

    // Fallback: al menos 3 números consecutivos en la línea → ítem con extracción parcial
    if (amountCount >= 3) {
      const nums = [...trimmed.matchAll(/\d[\d.,]*/g)].map((x) =>
        parseAmount(x[0])
      ).filter((n): n is number => n !== null);

      const textPart = trimmed.replace(/\d[\d.,]*/g, "").replace(/\s+/g, " ").trim();
      if (textPart.length < 3) continue; // Sin descripción significativa

      lineCounter++;
      items.push({
        nro: lineCounter,
        codigo: null,
        descripcion: textPart || null,
        um: null,
        cantidad: nums[0] ?? 1,
        precioUnitario: nums[1] ?? null,
        descuento: null,
        total: nums[nums.length - 1] ?? null,
      });
    }
  }

  return items;
}

// ─── Función principal ───────────────────────────────────────────────────────

export interface ExtractPdfOptions {
  fileName?: string;
}

export function extractDianInvoiceFromPdfText(
  pdfText: string,
  options: ExtractPdfOptions = {}
): DianCanonicalInvoice {
  const warnings: string[] = [];
  const lines = pdfText.split(/\r?\n/).map((l) => l.trimEnd());
  const fullText = pdfText;

  // ── Datos del documento ────────────────────────────────────────────────────

  const invoiceNumberMatch =
    fullText.match(/(?:Factura|No\.?|Número)\s*(?:de\s+venta\s+)?[:.]?\s*([A-Z]{0,5}\d{3,})/i) ??
    fullText.match(/\bFE\s*(\d{3,})\b/i);
  const invoiceNumber = invoiceNumberMatch
    ? (invoiceNumberMatch[0].match(/[A-Z]{0,5}\d{3,}/) ?? invoiceNumberMatch)[0]
    : null;

  // CUFE
  const cufeMatch = fullText.match(
    /(?:CUFE|cufe)\s*[:.]?\s*([A-Fa-f0-9]{50,100})/i
  );
  const cufe = cufeMatch?.[1] ?? null;

  // Fecha emisión — buscar "Fecha de emisión", "Fecha factura" + fecha
  const emisionMatch = fullText.match(
    /(?:fecha\s+(?:de\s+)?(?:emisi[oó]n|factura|expedici[oó]n))\s*[:.]?\s*(\d{1,2}[\s\/\-]\d{1,2}[\s\/\-]\d{4})/i
  );
  const fechaEmision = parsePdfDate(emisionMatch?.[1] ?? null);

  // Fecha vencimiento
  const vencMatch = fullText.match(
    /(?:vencimiento|fecha\s+l[ií]mite|fecha\s+pago|due\s+date)\s*[:.]?\s*(\d{1,2}[\s\/\-]\d{1,2}[\s\/\-]\d{4})/i
  );
  const fechaVencimiento = parsePdfDate(vencMatch?.[1] ?? null);

  // Forma de pago
  const formaPagoMatch = fullText.match(
    /(?:forma\s+(?:de\s+)?pago|payment\s+method)\s*[:.]?\s*(cr[eé]dito|contado|[\w\s]{3,20})/i
  );
  const rawFormaRaw = formaPagoMatch?.[1]?.trim() ?? null;
  const formaDePago = rawFormaRaw
    ? /cr[eé]dito/i.test(rawFormaRaw)
      ? "Crédito"
      : /contado/i.test(rawFormaRaw)
      ? "Contado"
      : rawFormaRaw
    : null;

  // Medio de pago
  const medioPagoMatch = fullText.match(
    /(?:medio\s+(?:de\s+)?pago|payment\s+means)\s*[:.]?\s*(\w[\w\s]{1,30})/i
  );
  const medioPago = medioPagoMatch?.[1]?.trim() ?? null;

  // Moneda
  const currencyMatch = fullText.match(/\b(COP|USD|EUR)\b/);
  const currency = currencyMatch?.[1] ?? "COP";

  // ── Detectar bloques ───────────────────────────────────────────────────────

  const blocks = detectBlocks(lines);
  const layoutDetected = blocks.map((b) => b.label).join(",");

  const headerBlock = blocks.filter((b) => b.label === "header").flatMap((b) => b.lines);
  const emisorBlock = blocks.filter((b) => b.label === "emisor").flatMap((b) => b.lines);
  const adquirienteBlock = blocks.filter((b) => b.label === "adquiriente").flatMap((b) => b.lines);
  const detailBlock = blocks.filter((b) => b.label === "detail").flatMap((b) => b.lines);
  const totalsBlock = blocks.filter((b) => b.label === "totals").flatMap((b) => b.lines);

  // Si no hay bloque específico de emisor, usar las primeras líneas
  const emisorLines = emisorBlock.length > 0 ? emisorBlock : lines.slice(0, 15);
  const adquirienteLines =
    adquirienteBlock.length > 0 ? adquirienteBlock : lines.slice(15, 30);

  // ── Emisor ─────────────────────────────────────────────────────────────────

  const emisorText = emisorLines.join("\n");
  const vendorNits = extractNitsFromBlock(emisorText);
  const vendorNit = vendorNits[0] ?? null;
  const vendorName = extractCompanyName(emisorLines) ?? null;

  if (!vendorName) warnings.push("emisor.razon_social no encontrada en PDF");
  if (!vendorNit) warnings.push("emisor.nit no encontrado en PDF");

  // Actividad económica — código CIIU de 4 dígitos
  const actividadMatch = emisorText.match(
    /(?:actividad\s+econ[oó]mica|ciiu)\s*[:.]?\s*(\d{4})/i
  );
  const actividadEconomica = actividadMatch?.[1] ?? null;

  // Régimen fiscal
  const regimenMatch = emisorText.match(
    /(?:r[eé]gimen\s+fiscal|responsabilidad)\s*[:.]?\s*([A-Z0-9\-]{2,20})/i
  );
  const regimenFiscal = regimenMatch?.[1] ?? null;

  // Dirección emisor — buscar "Dirección:", "Dir:", "Calle", "Carrera", "Av"
  const dirEmisorMatch = emisorText.match(
    /(?:direcci[oó]n|dir\.?)\s*[:.]?\s*((?:calle|carrera|cra|av\.?|avenida|km|transversal|tr\.?)\s+[\w\s\-\#.]{5,50})/i
  ) ?? emisorText.match(/((?:CL|CR|KM|AV|TR)\s+[\w\s\-\#.]{5,40})/i);
  const direccionEmisor = dirEmisorMatch?.[1]?.trim() ?? null;

  // Teléfono
  const telEmisorMatch = emisorText.match(
    /(?:tel[eé]fono|tel\.?|celular|móvil)\s*[:.]?\s*([\d\s\-\(\)]{7,15})/i
  ) ?? emisorText.match(/\b(3\d{9}|6\d{7})\b/);
  const telEmisor = telEmisorMatch?.[1]?.replace(/\s/g, "")?.trim() ?? null;

  // Correo
  const correoEmisorMatch = emisorText.match(/[\w.+-]+@[\w.-]+\.\w{2,6}/);
  const correoEmisor = correoEmisorMatch?.[0] ?? null;

  // ── Adquiriente ────────────────────────────────────────────────────────────

  const adquirienteText = adquirienteLines.join("\n");
  const customerNits = extractNitsFromBlock(adquirienteText);
  const customerNit = customerNits[0] ?? null;
  const customerName = extractCompanyName(adquirienteLines) ?? null;

  if (!customerName) warnings.push("adquiriente.razon_social no encontrada en PDF");

  // Correo adquiriente
  const correoClienteMatch = adquirienteText.match(/[\w.+-]+@[\w.-]+\.\w{2,6}/);
  const correoCliente = correoClienteMatch?.[0] ?? null;

  // ── Detalle ────────────────────────────────────────────────────────────────

  // Para el formato DIAN de "columnas concatenadas", intentar primero en las
  // líneas completas del PDF (el bloque de detalle puede estar mal delimitado).
  const concatenatedOnAll = parseConcatenatedDianItems(lines);
  const rawItems = concatenatedOnAll.length >= 5
    ? concatenatedOnAll
    : extractDetailLines(detailBlock.length > 0 ? detailBlock : lines);

  if (rawItems.length === 0) {
    warnings.push("No se encontraron ítems en el PDF (posible layout no estándar)");
  }

  const detalle: DianCanonicalInvoiceLine[] = rawItems.map((item) => ({
    detalle_Nro: pdfField(item.nro, "detail_table/nro", 0.7),
    detalle_Codigo: pdfField(item.codigo, "detail_table/codigo", 0.5),
    detalle_Descripcion: pdfField(item.descripcion, "detail_table/descripcion", 0.75),
    detalle_UM: pdfField(item.um, "detail_table/um", 0.6),
    detalle_Cantidad: pdfField(item.cantidad, "detail_table/cantidad", 0.8),
    detalle_Precio_unitario: pdfField(item.precioUnitario, "detail_table/precio_unit", 0.75),
    detalle_Descuento_detalle: pdfField(item.descuento, "detail_table/descuento", 0.6),
    detalle_Recargo_detalle: pdfField(null, "n/a", 0),
    detalle_impuesto_iva: pdfField(null, "n/a", 0),
    detalle_iva_perc: pdfField(null, "n/a", 0),
    detalle_impuesto_inc: pdfField(null, "n/a", 0),
    detalle_inc_perc: pdfField(null, "n/a", 0),
    detalle_precio_unitario_venta: pdfField(item.precioUnitario, "detail_table/precio_unit", 0.7),
    detalle_total_linea: pdfField(item.total, "detail_table/total_linea", 0.75),
    detalle_base_gravable: pdfField(null, "n/a", 0),
    detalle_notas: pdfField(null, "n/a", 0),
    detalle_propiedades_adicionales_json: pdfField(null, "n/a", 0),
  }));

  // ── Totales ────────────────────────────────────────────────────────────────

  const totalsText = totalsBlock.join("\n") + "\n" + fullText;

  const subtotalMatch = totalsText.match(
    /(?:subtotal|valor\s+bruto|base\s+gravable)\s*[:.]?\s*([\d.,]+)/i
  );
  const subtotal = parseAmount(subtotalMatch?.[1] ?? "");

  const ivaMatch = totalsText.match(
    /(?:iva|impuesto\s+al\s+valor)\s*[\d%]?\s*[:.]?\s*([\d.,]+)/i
  );
  const iva = parseAmount(ivaMatch?.[1] ?? "");

  // INC — puede aparecer concatenado sin espacio: "INC1.782.696,53"
  const incMatch = totalsText.match(/^INC\s*([\d.]+,\d{2})\s*$/m);
  const inc = parseAmount(incMatch?.[1] ?? "");

  // Total factura — soporta rellenos de caracteres especiales y "COP $"
  // Ej: "Total factura (=) ᅠᅠᅠᅠᅠᅠᅠᅠᅠᅠ COP $25.507.267,00"
  // [^\d\n]* = no cruzar líneas (evita capturar números de otras líneas)
  const totalMatch =
    totalsText.match(/Total\s+factura[^\d\n]*([\d.]+,\d{2})/i) ??
    totalsText.match(/Total\s+neto\s+factura[^\d\n]*([\d.]+,\d{2})/i) ??
    totalsText.match(/(?:total\s+(?:a\s+pagar|neto)|valor\s+total)\s*[:.]?\s*([\d.,]+)/i);
  const totalFactura = parseAmount(totalMatch?.[1] ?? "");

  // Validar cuadre (subtotal + IVA + INC ≈ total)
  if (subtotal !== null && totalFactura !== null) {
    const ivaVal = iva ?? 0;
    const incVal = inc ?? 0;
    if (Math.abs((subtotal + ivaVal + incVal) - totalFactura) > 100) {
      warnings.push(
        `Cuadre PDF: subtotal(${subtotal}) + IVA(${ivaVal}) + INC(${incVal}) ≠ total(${totalFactura})`
      );
    }
  }

  // Confianza global del PDF
  const confidence = warnings.length === 0 ? 0.70 : Math.max(0.30, 0.70 - warnings.length * 0.08);

  const p = <T>(value: T, pattern: string, conf = 0.70) =>
    pdfField(value, pattern, value !== null ? conf : 0);

  return {
    datos_documento_numero_factura: p(invoiceNumber, "regex/invoice_number"),
    datos_documento_cufe: p(cufe, "regex/CUFE", 0.90),
    datos_documento_fecha_emision: p(fechaEmision, "regex/fecha_emision"),
    datos_documento_hora_emision: notFound(),
    datos_documento_fecha_vencimiento: p(fechaVencimiento, "regex/fecha_vencimiento"),
    datos_documento_tipo_operacion: notFound(),
    datos_documento_tipo_documento: notFound(),
    datos_documento_forma_de_pago: p(formaDePago, "regex/forma_pago"),
    datos_documento_medio_de_pago: p(medioPago, "regex/medio_pago", 0.60),
    datos_documento_orden_pedido: notFound(),
    datos_documento_fecha_orden_pedido: notFound(),

    datos_emisor_vendedor_razon_social: p(vendorName, "company_name_heuristic", 0.65),
    datos_emisor_vendedor_nombre_comercial: notFound(),
    datos_emisor_vendedor_nit_emisor: p(vendorNit, "regex/NIT_labeled", 0.75),
    datos_emisor_vendedor_tipo_documento: notFound(),
    datos_emisor_vendedor_tipo_contribuyente: notFound(),
    datos_emisor_vendedor_regimen_fiscal: p(regimenFiscal, "regex/regimen_fiscal", 0.55),
    datos_emisor_vendedor_responsabilidad_tributaria: notFound(),
    datos_emisor_vendedor_actividad_economica: p(actividadEconomica, "regex/ciiu", 0.70),
    datos_emisor_vendedor_pais: p("CO", "inferred_co", 0.50),
    datos_emisor_vendedor_departamento: notFound(),
    datos_emisor_vendedor_municipio_ciudad: notFound(),
    datos_emisor_vendedor_direccion: p(direccionEmisor, "regex/direccion", 0.55),
    datos_emisor_vendedor_telefono_movil: p(telEmisor, "regex/telefono", 0.60),
    datos_emisor_vendedor_correo: p(correoEmisor, "regex/email", 0.80),

    datos_adquiriente_comprador_nombre_razon_social: p(customerName, "company_name_heuristic", 0.60),
    datos_adquiriente_comprador_tipo_documento: notFound(),
    datos_adquiriente_comprador_numero_documento: p(customerNit, "regex/NIT_labeled", 0.70),
    datos_adquiriente_comprador_tipo_contribuyente: notFound(),
    datos_adquiriente_comprador_regimen_fiscal: notFound(),
    datos_adquiriente_comprador_responsabilidad_tributaria: notFound(),
    datos_adquiriente_comprador_pais: p("CO", "inferred_co", 0.50),
    datos_adquiriente_comprador_departamento: notFound(),
    datos_adquiriente_comprador_municipio_ciudad: notFound(),
    datos_adquiriente_comprador_direccion: notFound(),
    datos_adquiriente_comprador_telefono_movil: notFound(),
    datos_adquiriente_comprador_correo: p(correoCliente, "regex/email", 0.80),

    detalle,

    totales_moneda: p(currency, "regex/currency_code", 0.80),
    totales_subtotal: p(subtotal, "regex/subtotal"),
    totales_descuento_detalle: notFound(),
    totales_recargo_detalle: notFound(),
    totales_total_bruto_factura: p(subtotal, "regex/subtotal", 0.60),
    totales_IVA: p(iva ?? 0, "regex/iva", 0.65),
    totales_INC: p(inc ?? null, "regex/inc", 0.70),
    totales_bolsas: notFound(),
    totales_otros_impuestos: notFound(),
    totales_total_impuesto: p((iva ?? 0) + (inc ?? 0), "regex/impuesto_total", 0.65),
    totales_total_neto_factura: p(totalFactura, "regex/total_factura"),
    totales_descuento_global: notFound(),
    totales_recargo_global: notFound(),
    totales_total_factura: p(totalFactura, "regex/total_factura"),
    totales_anticipos: notFound(),
    totales_rete_fuente: notFound(),
    totales_rete_iva: notFound(),
    totales_rete_ica: notFound(),

    source_file_name: options.fileName ?? "unknown.pdf",
    source_file_type: "pdf",
    extraction_source: "pdf",
    extraction_confidence: confidence,
    extraction_warnings: warnings,
    xml_detected_type: null,
    xml_is_attached_document: false,
    xml_embedded_invoice_found: false,
    pdf_layout_detected: layoutDetected,
    parser_version: PARSER_VERSION_PDF,
    source_payload_json: null,
  };
}
