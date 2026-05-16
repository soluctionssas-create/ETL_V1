# DIAN Canonical Extraction — Documentación técnica

## Índice
1. [Contexto](#contexto)
2. [Arquitectura del extractor](#arquitectura-del-extractor)
3. [Tipos canónicos](#tipos-canónicos)
4. [Mapeo de campos](#mapeo-de-campos)
5. [Fuentes de extracción y confianza](#fuentes-de-extracción-y-confianza)
6. [AttachedDocument (DIAN wrapping)](#attacheddocument-dian-wrapping)
7. [Limitaciones del extractor PDF](#limitaciones-del-extractor-pdf)
8. [Migración de base de datos](#migración-de-base-de-datos)
9. [Tests](#tests)

---

## Contexto

Las facturas electrónicas colombianas siguen el estándar **DIAN UBL 2.1**. El proveedor
tecnológico de facturación las envía al receptor en dos formatos posibles:

- **XML directo** (`<Invoice>` raíz) — máxima fidelidad, ~40 campos extraíbles.
- **AttachedDocument** (`<fe:AttachedDocument>`) — el XML de la Invoice llega dentro de
  un `<cbc:Description><![CDATA[...]]>` envuelto por un documento contenedor.
- **PDF de representación gráfica** — fuente de respaldo cuando no hay XML; menor
  fidelidad (~20-25 campos, confianza 0.70).
- **ZIP** — puede contener XML y/o PDF dentro.

---

## Arquitectura del extractor

```
apps/web/
├── lib/dian/
│   ├── dian-canonical-types.ts   # Tipos TypeScript — fuente de verdad
│   ├── extract-dian-xml.ts       # Extractor XML DIAN UBL 2.1
│   ├── extract-dian-pdf.ts       # Extractor PDF basado en bloques
│   └── index.ts                  # Barrel + mappers DB
└── app/api/v1/invoices/
    └── batches/route.ts          # POST handler (consume lib/dian)
```

### Flujo de datos

```
Archivo subido (XML | PDF | ZIP)
        │
        ▼
buildInvoiceSeed() en route.ts
        │
        ├─── XML ──────► extractDianInvoiceFromXml()
        │                        │
        ├─── PDF ──────► extractDianInvoiceFromPdfText()
        │                        │
        └─── ZIP ──────► detecta XML dentro → extractDianInvoiceFromXml()
                         si no XML → PDF dentro → extractDianInvoiceFromPdfText()
                                  │
                                  ▼
                         DianCanonicalInvoice (objeto tipado)
                                  │
                          ┌───────┴───────┐
                          ▼               ▼
              canonicalToFacturaDian()  canonicalLinesToDetalles()
                          │               │
                          ▼               ▼
                   facturas_dian      facturas_dian_detalle
                   (INSERT Supabase)  (INSERT Supabase)
```

---

## Tipos canónicos

### `DianExtractedField<T>`

Cada campo extraído lleva metadatos de trazabilidad:

```typescript
interface DianExtractedField<T> {
  value: T;                  // valor extraído (null si no encontrado)
  source: ExtractionSource;  // "xml" | "pdf" | "inferred" | "not_found"
  confidence: number;        // 0..1 (XML ≈ 0.95, PDF ≈ 0.70)
  path_or_pattern: string;   // XPath aproximado o regex usada
}
```

### `DianCanonicalInvoice`

Objeto de 40+ campos organizados en secciones:

| Sección | Campos | Fuente principal |
|---------|--------|-----------------|
| `datos_documento_*` | 11 campos | `<cbc:ID>`, `<cbc:IssueDate>`, etc. |
| `datos_emisor_vendedor_*` | 14 campos | `<cac:AccountingSupplierParty>` |
| `datos_adquiriente_comprador_*` | 12 campos | `<cac:AccountingCustomerParty>` |
| `detalle[]` | 17 campos/línea | `<cac:InvoiceLine>` |
| `totales_*` | 19 campos | `<cac:LegalMonetaryTotal>`, `<cac:TaxTotal>` |
| metadata | 10 campos | interno (no persistido como columna) |

---

## Mapeo de campos

### Documento → `facturas_dian`

| Campo canónico | Columna DB | XML path | PDF fallback |
|----------------|-----------|----------|-------------|
| `datos_documento_numero_factura` | `doc_numero_factura` | `//cbc:ID` | regex número de factura |
| `datos_documento_fecha_emision` | `doc_fecha_emision` | `//cbc:IssueDate` | regex DD/MM/YYYY |
| `datos_documento_fecha_vencimiento` | `doc_fecha_vencimiento` | `//cbc:DueDate` | regex vencimiento |
| `datos_documento_forma_de_pago` | `doc_forma_pago` | `//cac:PaymentMeans/cbc:ID` → DIAN_FORMA_PAGO | texto |
| `datos_documento_medio_de_pago` | `doc_medio_pago` | `//cac:PaymentMeans/cbc:PaymentMeansCode` | texto |
| `datos_emisor_vendedor_razon_social` | `emisor_razon_social` | `//cac:PartyLegalEntity/cbc:RegistrationName` | heurístico (sufijo legal / MAYÚSCULAS) |
| `datos_emisor_vendedor_nit_emisor` | `emisor_nit` | `//cac:PartyTaxScheme/cbc:CompanyID` | label "NIT:" |
| `datos_emisor_vendedor_actividad_economica` | `emisor_actividad_economica` | `//cac:IndustryClassificationCode` | — |
| `totales_subtotal` | `tot_subtotal` | `//cac:LegalMonetaryTotal/cbc:LineExtensionAmount` | regex subtotal |
| `totales_IVA` | `tot_iva` | sum TaxTotal schemeID=01 | regex IVA |
| `totales_total_factura` | `tot_total_factura` | `//cac:LegalMonetaryTotal/cbc:PayableAmount` | regex total |

### Detalle → `facturas_dian_detalle`

| Campo canónico | Columna DB |
|----------------|-----------|
| `detalle_Descripcion` | `detalle_descripcion` |
| `detalle_UM` | `detalle_um` |
| `detalle_Cantidad` | `detalle_cantidad` |
| `detalle_Precio_unitario` | `detalle_precio_unitario` |
| `detalle_impuesto_iva` | `detalle_impuesto_iva` |
| `detalle_iva_perc` | `detalle_porcentaje_iva` |
| `detalle_total_linea` | `detalle_total_linea` *(columna nueva)* |
| `detalle_base_gravable` | `detalle_base_gravable` *(columna nueva)* |
| `detalle_notas` | `detalle_notas` *(columna nueva)* |

---

## Fuentes de extracción y confianza

| Fuente | Confianza base | Cuándo se usa |
|--------|---------------|---------------|
| `xml` | 0.95 | XML DIAN UBL 2.1 directo o dentro de ZIP |
| `pdf` | 0.70 | PDF de representación gráfica |
| `inferred` | 0.50 | Valor deducido (ej: forma de pago por código) |
| `not_found` | 0.00 | Campo no encontrado en la fuente |

`canonical_invoice_json` persiste el objeto `DianCanonicalInvoice` completo en
Supabase como JSONB, lo que permite re-análisis sin re-procesar el archivo.

`extraction_warnings_json` almacena advertencias del extractor (ej: "AttachedDocument
sin CDATA", "líneas de detalle vacías").

---

## AttachedDocument (DIAN wrapping)

Muchos proveedores tecnológicos envían el XML en formato `AttachedDocument`:

```xml
<fe:AttachedDocument>
  ...
  <cbc:Description><![CDATA[
    <?xml version="1.0" encoding="UTF-8"?>
    <Invoice xmlns="...">...</Invoice>
  ]]></cbc:Description>
  ...
</fe:AttachedDocument>
```

La función `unwrapAttachedDocument()` detecta este patrón y extrae automáticamente
el `<Invoice>` embebido. Si el CDATA no contiene un XML válido, se devuelve el
documento raíz original y se agrega un warning.

---

## Limitaciones del extractor PDF

El PDF de representación gráfica **no es una fuente canónica**:

- No contiene CUFE ni estructura UBL.
- Los nombres de empresa se extraen por heurístico (sufijo legal S.A., S.A.S., LTDA, o MAYÚSCULAS).
- Los NITs se extraen por proximidad al label "NIT:"; pueden confundirse con otros números.
- La detección de líneas de detalle usa bloques textuales y reglas estructurales para
  evitar falsos positivos (bug pre-existente: 20-50 ítems falsos por PDF).
- La confianza de todos los campos PDF es 0.70 como máximo.

**Recomendación:** priorizar siempre el XML. El PDF es fallback de último recurso.

---

## Migración de base de datos

Ejecutar en **Supabase Dashboard → SQL Editor**:

```sql
-- Ver: database/supabase_dian_canonical_extraction.sql
```

El script es idempotente (`ADD COLUMN IF NOT EXISTS`). Las nuevas columnas son:

**`facturas_dian`:**
- `canonical_invoice_json JSONB` — objeto canónico completo
- `extraction_payload_json JSONB` — payload crudo de extracción
- `extraction_warnings_json JSONB` — lista de warnings
- `fuente_extraccion TEXT` — "xml" | "pdf" | "inferred"
- `confianza_extraccion NUMERIC(4,2)` — valor 0.00..1.00
- `version_parser TEXT` — "dian-xml-v1.0.0" | "dian-pdf-v1.0.0"

**`facturas_dian_detalle`:**
- `detalle_total_linea NUMERIC(18,2)`
- `detalle_base_gravable NUMERIC(18,2)`
- `detalle_notas TEXT`
- `detalle_propiedades_adicionales_json JSONB`

---

## Tests

```bash
cd apps/web
npx vitest run __tests__/dian-extraction.test.ts
```

El test valida el fixture `tests/fixtures/dian_FE1789.xml` contra los valores esperados:
- Número de factura: `FE1789`
- Emisor NIT: `805023122` / razón social: `TRANSPORTES FENIX S.A.`
- Adquiriente NIT: `901814874` / razón social: `FRUITT COL S.A.S.`
- Total factura: `3,800,000 COP`
- IVA: `0`
- 1 línea de detalle: `SERVICIO DE TRANSPORTE TERRESTRE`

---

*Versión: dian-xml-v1.0.0 / dian-pdf-v1.0.0 — Sin clasificación IA en esta fase.*
