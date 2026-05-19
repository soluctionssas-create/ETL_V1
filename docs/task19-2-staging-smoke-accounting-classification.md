# Task 19.2 — Smoke Test E2E Staging: Motor Contable con Memoria Tenant

**Fecha:** 2026-05-19  
**Preview URL:** `https://etl-v1-695l32vbz-soluctionssas.vercel.app`  
**Staging DB:** `skrjyrnprmoattwlitzs`  
**Commit base:** `67e4fd3` (local) — "feat: Task 19/19.1 accounting classification engine with tenant memory"

---

## Objetivo

Validar end-to-end que el motor contable asigna correctamente la cuenta PUC `5135` a
facturas procesadas en staging, utilizando la memoria de proveedor (`tenant_supplier_memory`)
del tenant, en lugar de clasificaciones genéricas.

---

## Bugs Resueltos en Esta Sesión

### Bug 1 — Typo `supplierMemory` vs `supplier_memory`
- **Archivo:** `apps/web/app/api/v1/invoices/batches/[batchId]/recalculate-tax/route.ts`
- **Error:** El route accedía a `classifyCtx?.supplierMemory` (camelCase) pero `ClassifyContext`
  define la propiedad como `supplier_memory` (snake_case). TypeScript en modo estricto lo
  detecta, pero el build local pasaba porque había un error pre-existente que lo enmascaraba.
- **Fix:** Cambiar a `classifyCtx?.supplier_memory`

### Bug 2 — `.catch()` sobre `PostgrestBuilder` (Supabase v2)
- **Archivo:** `apps/web/lib/tax/load-classify-context.ts` (línea ~130)
- **Error original:** `patternsQuery.catch(() => ...)` fallaba con `TypeError: a.catch is not a function`
- **Causa raíz:** En Supabase JS v2, los query builders (`PostgrestFilterBuilder`) implementan
  `PromiseLike<T>` (solo `.then()`), NO la interfaz completa de `Promise`. Llamar `.catch()`
  directamente sobre un query builder lanza `TypeError` en runtime.
- **Síntoma observado:** `loadClassifyContext` lanzaba una excepción que el route atrapaba
  silenciosamente (`catch(() => undefined)`), resultando en `classifyCtx = undefined` y
  por ende `suggested_account_code = NULL` en la DB.
- **Fix aplicado:**
  ```typescript
  // ANTES (buggy):
  const patternsResult = await patternsQuery.catch(() => ({ data: null, error: null }));

  // DESPUÉS (correcto):
  const patternsResult = await patternsQuery.then(
    (r: { data: unknown; error: unknown }) => r,
    () => ({ data: null, error: null })
  );
  ```
- **Alternativas igualmente válidas:**
  ```typescript
  // Opción B — try/catch
  let patternsResult;
  try { patternsResult = await patternsQuery; }
  catch { patternsResult = { data: null, error: null }; }

  // Opción C — Promise.resolve() wrapper
  const patternsResult = await Promise.resolve(patternsQuery).catch(() => ({ data: null, error: null }));
  ```
- **Regla general:** Siempre envolver en `Promise.resolve()` o usar `.then(onFulfilled, onRejected)`
  al añadir handlers de error a queries de Supabase. NUNCA llamar `.catch()` directamente.

---

## Datos de Staging Utilizados

| Entidad | ID / Valor |
|---------|-----------|
| Tenant | `00000000-0000-0000-0000-000000000001` |
| Batch | `00000000-0000-0000-0000-000000000010` (seed-test.zip) |
| Factura DIAN | `00000000-0000-0000-0000-000000000200` |
| Invoice (invoices table) | `00000000-0000-0000-0000-000000000101` (DIAN-001) |
| Supplier NIT | `900123456` |
| Supplier `default_account_code` | `5135` |
| Supplier `manually_confirmed` | `true` |
| Expected `account_memory_source` | `"manual"` |

### Seed de `tenant_supplier_memory` (aplicado en Task 19.1)
```sql
INSERT INTO tenant_supplier_memory (
  tenant_id, supplier_nit, default_account_code,
  default_cost_or_expense, manually_confirmed, total_invoices
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '900123456',
  '5135',
  'expense',
  true,
  1
) ON CONFLICT DO NOTHING;
```

---

## Pasos del Smoke Test E2E

### Step 1–4: Preparación (completados en sesión anterior)
- [x] `git commit` feat Task 19/19.1
- [x] Variables de entorno en Vercel (staging URL + service role key)
- [x] Primera Preview deploy exitosa

### Step 5: Primer recalculate-tax (confirmado `ok: true`)
```http
POST /api/v1/invoices/batches/00000000-0000-0000-0000-000000000010/recalculate-tax
→ { "ok": true, "processed": 1, "skipped": 0, "errors": [] }
```

### Step 6: Validación en DB — `suggested_account_code = "5135"`
```sql
SELECT supplier_nit, suggested_account_code, account_memory_source, cost_or_expense
FROM invoice_tax_calculations
WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

-- Resultado esperado (y obtenido):
-- supplier_nit | suggested_account_code | account_memory_source | cost_or_expense
-- 900123456    | 5135                   | manual                | expense
```
**Resultado:** ✅ `suggested_account_code = "5135"`, `account_memory_source = "manual"`

### Step 7: UI `/classification` muestra cuenta `5135`
- Navegar a `https://etl-v1-695l32vbz-soluctionssas.vercel.app/classification`
- Seleccionar lote `seed-test.zip` (batch `00000000-0000-0000-0000-000000000010`)
- Columna **"Cuenta IA"** muestra `5135` con tooltip "Cuenta de memoria del proveedor"

**Resultado:** ✅ UI confirma cuenta `5135` visible

### Step 8: Endpoint `/reprocess`
```http
POST /api/v1/invoices/DIAN-001/reprocess
→ {
    "ok": true,
    "invoice_id": "00000000-0000-0000-0000-000000000101",
    "invoice_number": "DIAN-001",
    "action": "inserted",
    "requires_review": true,
    "detail_lines": 1,
    "warnings": [
      "Ciudad ReteICA inferida de la factura (BOGOTA → BOGOTA)...",
      "ReteIVA: factura reporta 0.00, calculado 2850.00, diferencia 2850.00"
    ]
  }
```
**Resultado:** ✅ `reprocess` funciona correctamente

### Step 9: Documentación
- [x] Este archivo creado en `docs/`

---

## Tests

```
Test Files  13 passed (13)
     Tests  229 passed (229)
  Duration  2.69s
```

Todos los tests de la suite pasan sin cambios. El fix de `patternsQuery.then(r, onError)`
es compatible con la capa de tests (que mockean las queries de Supabase).

---

## Lección Aprendida: Supabase v2 `PromiseLike` vs `Promise`

**Contexto:** En `@supabase/supabase-js` v2, los query builders (`PostgrestFilterBuilder`,
`PostgrestTransformBuilder`, etc.) son **thenables** (`PromiseLike<T>`) pero **no** instancias
de `Promise`. La diferencia práctica:

| Método | `PromiseLike` | `Promise` |
|--------|---------------|-----------|
| `.then(onFulfilled)` | ✅ Disponible | ✅ Disponible |
| `.then(onFulfilled, onRejected)` | ✅ Disponible | ✅ Disponible |
| `.catch(onRejected)` | ❌ NO disponible | ✅ Disponible |
| `.finally(onFinally)` | ❌ NO disponible | ✅ Disponible |

**Por qué `Promise.allSettled()` funciona:** Internamente llama `.then()` sobre cada elemento,
que sí está disponible. `await` también usa solo `.then()`.

**Patrón seguro para manejo de errores en queries Supabase:**
```typescript
// ✅ CORRECTO
const result = await query.then(r => r, () => fallback);
const result = await Promise.resolve(query).catch(() => fallback);
try { result = await query; } catch { result = fallback; }

// ❌ INCORRECTO
const result = await query.catch(() => fallback);  // TypeError!
const result = await query.finally(() => cleanup()); // TypeError!
```

---

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `apps/web/lib/tax/load-classify-context.ts` | Fix Bug 2: `.then(r, fallback)` en lugar de `.catch(fallback)` |
| `apps/web/app/api/v1/invoices/batches/[batchId]/recalculate-tax/route.ts` | Fix Bug 1: `supplier_memory` (snake_case); eliminación de debug logs |

---

## Estado Final

| Componente | Estado |
|------------|--------|
| `suggested_account_code` en DB | ✅ `"5135"` (era NULL) |
| `account_memory_source` en DB | ✅ `"manual"` |
| UI `/classification` Cuenta IA | ✅ Muestra `5135` |
| `/reprocess` endpoint | ✅ `{ok: true}` |
| Tests (229/229) | ✅ Todo verde |
| Build TypeScript | ✅ Sin errores |

**Pendiente (requiere autorización explícita del usuario):**
- Aplicar migración `task19_suggested_account.sql` a producción (`pvzchcscuqpzuaxbfihh`)
- `git push` al repositorio remoto
- `npx vercel --prod`
