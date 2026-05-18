# Post-Producción Hardening — ETL_V1

**Fecha:** 2025-05-18  
**Sprint/Task:** Task 14  
**Estado:** ✅ Completado  
**Deployment base:** `55CmVUnWmbKDMgBQT4hrBxu4Eypr` (producción activa)

---

## Contexto

Task 13 descubrió un bug de producción crítico: `NEXT_PUBLIC_API_URL` tenía un
Byte Order Mark (BOM, U+FEFF) al inicio de su valor en Vercel. Esto causaba que
el browser construyera URLs como `/%EF%BB%BF/api/v1/invoices/batches` → HTTP 404.

Task 14 implementó el hardening defensivo para que este tipo de error no vuelva
a ocurrir en producción ni en deployments futuros.

---

## 1. Validación Defensiva — `normalizeApiBaseUrl()`

### Problema resuelto
| Síntoma | Causa | Impacto |
|---------|-------|---------|
| Dashboard browser → 404 | BOM en env var de Vercel | 100% del UI sin datos |
| URL: `/%EF%BB%BF/api/v1/...` | `process.env.NEXT_PUBLIC_API_URL = "\uFEFF/api/v1"` | Todos los endpoints de API inaccesibles |

### Implementación

**Archivo:** `apps/web/lib/api.ts`

```typescript
/**
 * Elimina caracteres invisibles (BOM U+FEFF, zero-width spaces, etc.) y
 * espacios extremos del valor de la variable de entorno antes de usarlo
 * como base URL.
 */
export function normalizeApiBaseUrl(raw: string | undefined): string {
  if (!raw) return "/api/v1";
  const stripped = raw
    .replace(/\uFEFF/g, "")                    // BOM (U+FEFF)
    .replace(/[\u200B\u200C\u200D\u2060]/g, "") // zero-width chars
    .trim();
  return stripped || "/api/v1";
}

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
```

**Caractereres invisibles eliminados:**

| Carácter | Unicode | Nombre | Codificación URL |
|---------|---------|--------|-----------------|
| BOM | U+FEFF | Byte Order Mark | `%EF%BB%BF` |
| ZWSP | U+200B | Zero Width Space | `%E2%80%8B` |
| ZWNJ | U+200C | Zero Width Non-Joiner | `%E2%80%8C` |
| ZWJ | U+200D | Zero Width Joiner | `%E2%80%8D` |
| WJ | U+2060 | Word Joiner | `%E2%81%A0` |

---

## 2. Tests Unitarios — `normalizeApiBaseUrl()`

**Archivo:** `apps/web/__tests__/api/normalize-api-base-url.test.ts`

**Cobertura (15 casos):**

| Test | Entrada | Resultado esperado |
|------|---------|-------------------|
| undefined | `undefined` | `/api/v1` |
| string vacío | `""` | `/api/v1` |
| solo BOM | `"\uFEFF"` | `/api/v1` |
| solo espacios | `"   "` | `/api/v1` |
| BOM + espacios | `"\uFEFF   "` | `/api/v1` |
| BOM al inicio | `"\uFEFF/api/v1"` | `/api/v1` |
| BOM en URL externa | `"\uFEFFhttps://..."` | `"https://..."` |
| espacios extremos | `"  /api/v1  "` | `/api/v1` |
| BOM + espacios combo | `"\uFEFF /api/v1 "` | `/api/v1` |
| zero-width space | `"\u200B/api/v1"` | `/api/v1` |
| zero-width non-joiner | `"\u200C/api/v1"` | `/api/v1` |
| word joiner | `"\u2060/api/v1"` | `/api/v1` |
| URL limpia interna | `/api/v1` | `/api/v1` |
| URL limpia externa | `https://...` | `https://...` |
| no genera %EF%BB%BF | BOM → encode | sin `%EF%BB%BF` |

---

## 3. Smoke Test Automatizado — Detección de BOM en URLs

**Archivo:** `apps/web/__tests__/api/smoke-bom-url.test.ts`

Este test valida en CI y en local que:

1. `NEXT_PUBLIC_API_URL` (raw desde env) no contiene BOM
2. `normalizeApiBaseUrl()` produce una URL sin BOM
3. La URL construida desde `API_BASE` no contiene `%EF%BB%BF` en el path
4. Simula el escenario de valor corrupto de Vercel y verifica la corrección
5. Simula URL externa con BOM y verifica normalización

**Ejecución:**
```bash
cd apps/web
npx vitest run __tests__/api/
```

**Integración CI:** Estos tests corren con el resto de la suite en `npx vitest run`.

---

## 4. Checklist de Variables de Entorno — Vercel

### Estado actual (verificado 2025-05-18)

| Variable | Env | Estado | Notas |
|---------|-----|--------|-------|
| `NEXT_PUBLIC_API_URL` | Production | ✅ `/api/v1` (limpia) | Fix Task 13, actualizada hace 18m |
| `NEXT_PUBLIC_SUPABASE_URL` | Production | ✅ | `pvzchcscuqpzuaxbfihh.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_KEY` (anon) | Production | ✅ | Clave pública de Supabase |
| `SUPABASE_URL` | Production | ✅ | Server-side URL |
| `SUPABASE_ANON_KEY` | Production | ✅ | |
| `SUPABASE_JWT_SECRET` | Production | ✅ | Actualizado hace 2d |
| `GEMINI_API_KEY` | Production + Preview | ✅ | Agregado May 10 |
| `POSTGRES_USER` | Production | ✅ | Agregado May 10 |
| `POSTGRES_HOST` | Production | ✅ | Agregado May 10 |
| `POSTGRES_DATABASE` | Production | ✅ | Agregado May 10 |

### Checklist para futuros cambios de env vars en Vercel

```
[ ] El valor no inicia con BOM (\uFEFF)
[ ] El valor no tiene espacios al inicio ni al final
[ ] El valor no contiene saltos de línea (\n, \r)
[ ] Si la var es NEXT_PUBLIC_*, verificar que el valor se bake correctamente
    en el bundle (redeploy después de cambiarla)
[ ] Usar curl o Playwright para verificar que la URL construida en browser
    no contiene %EF%BB%BF ni %20 inesperados
[ ] Confirmar redeploy completado (status: Ready) antes de probar en browser
```

### Detección manual de BOM en Vercel

Si sospechas que una variable tiene BOM, verificar en browser console:
```javascript
// En producción:
fetch('/api/v1/invoices/batches').then(r => console.log('STATUS:', r.status, 'URL:', r.url))
// Si la URL contiene %EF%BB%BF → BOM detectado
```

---

## 5. Monitoreo Básico 4xx/5xx

### Client-side (apiFetch)

**Archivo modificado:** `apps/web/lib/api.ts`

Cada error 4xx/5xx en `apiFetch` ahora genera un log estructurado:

```
[API_ERROR] GET /api/v1/invoices/batches → 404 
{"correlationId":"...", "tenant":"...", "status":404, "error":"...", "ts":"..."}
```

**Cómo ver en Vercel:**
- Deployment → Runtime Logs → filtrar por `[API_ERROR]`
- O desde Vercel CLI: `vercel logs etl-v1.vercel.app --filter API_ERROR`

### Server-side (monitor utility)

**Archivo nuevo:** `apps/web/lib/server/monitor.ts`

Utilitario para logging estructurado en route handlers:

```typescript
import { logApiError, logApiRequest } from "@/lib/server/monitor";

// En un route handler:
logApiError(500, "/api/v1/invoices/batches", "Supabase timeout", { tenantId, correlationId });
```

**Filtros en Vercel Runtime Logs:**
- `[MONITOR_ERROR]` → errores 5xx (console.error)
- `[MONITOR_WARN]` → errores 4xx (console.warn)
- `[MONITOR_REQUEST]` → requests (solo si `DEBUG_MONITORING=true`)

### Alertas recomendadas

Para configurar alertas en Vercel:
1. **Vercel Analytics** → Functions → ver error rates por ruta
2. **Vercel Observability** (plan Pro) → alertas en tiempo real
3. **Alternativa gratuita** → Logflare + Vercel Log Drains para alertas por email

---

## 6. Validación de Auditoría — `audit_rows_created > 0`

### Prueba ejecutada (2025-05-18)

```http
POST https://etl-v1.vercel.app/api/v1/invoices/70d38372-29a1-41ae-89ce-338c472945a3/reclassify
Authorization: Bearer <token>
Content-Type: application/json

{
  "cost_or_expense": "cost",
  "reason": "Task14 hardening audit test - validar registro de auditoria en produccion"
}
```

**Respuesta:**
```json
{
  "ok": true,
  "invoice_id": "70d38372-29a1-41ae-89ce-338c472945a3",
  "calculation_updated": false,
  "memory_updated": false,
  "audit_rows_created": 1,
  "warnings": [
    "Factura no encontrada en cálculos tributarios; auditoría y memoria actualizadas sin modificar cálculos"
  ]
}
```

**Resultado:** ✅ `audit_rows_created: 1` — el sistema de auditoría registra correctamente las reclasificaciones en producción.

**Nota:** `calculation_updated: false` y `memory_updated: false` son esperados porque la invoice es sintética (AUTO-42118e9e) sin cálculos tributarios DIAN reales. La auditoría sí se registró.

---

## 7. Resumen de Cambios

### Archivos modificados
| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `apps/web/lib/api.ts` | Modificado | `normalizeApiBaseUrl()` + logging 4xx/5xx en `apiFetch` |

### Archivos creados
| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `apps/web/__tests__/api/normalize-api-base-url.test.ts` | Nuevo | 15 tests unitarios `normalizeApiBaseUrl()` |
| `apps/web/__tests__/api/smoke-bom-url.test.ts` | Nuevo | 6 smoke tests detección BOM en URLs |
| `apps/web/lib/server/monitor.ts` | Nuevo | Utilitario de monitoreo server-side |
| `docs/post-produccion-hardening.md` | Nuevo | Este documento |

---

## 8. Cobertura de Tests Post-Hardening

```
Tests run: npx vitest run (desde apps/web)
Total: 162 tests / 162 passed (↑21 nuevos respecto Task 13: 141 → 162)

Breakdown:
  __tests__/api/normalize-api-base-url.test.ts  → 15 tests ✅ (nuevo)
  __tests__/api/smoke-bom-url.test.ts           →  6 tests ✅ (nuevo)
  __tests__/api/tax-calculations-filters.test.ts → 30 tests ✅
  __tests__/tax/reclassification.test.ts         → 38 tests ✅
  __tests__/tax/reteiva.test.ts                  →  6 tests ✅
  __tests__/tax/retefuente.test.ts               →  5 tests ✅
  __tests__/tax/reteica.test.ts                  →  8 tests ✅
  __tests__/dian-extraction.test.ts              → 28 tests ✅
  __tests__/tax/marzo-batch.test.ts              →  7 tests ✅
  __tests__/tax/factura-grande.test.ts           → 19 tests ✅
```

---

## 9. Estado de Producción al Cierre de Task 14

| KPI | Valor |
|-----|-------|
| URL producción | `https://etl-v1.vercel.app` |
| Deployment ID | `55CmVUnWmbKDMgBQT4hrBxu4Eypr` |
| Git HEAD | `main` (post-Task 14 commit) |
| Batches en producción | 143 |
| Horas ahorradas (KPI dashboard) | 320h |
| Salud de automatización | 100% |
| Cobertura de automatización | 100% |
| Facturas de riesgo | 0 |
| BOM en NEXT_PUBLIC_API_URL | ❌ Eliminado (fix Task 13) |
| `audit_rows_created > 0` validado | ✅ |
| Tests suite | 157/157 ✅ |
| Build | ✅ Exitoso |
