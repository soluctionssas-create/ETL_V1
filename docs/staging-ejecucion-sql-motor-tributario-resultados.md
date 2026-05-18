# Resultados: Ejecución SQL Staging — Motor Tributario ETL_V1

**Tarea:** 11 — Crear y validar ambiente Supabase Staging para el motor tributario  
**Fecha de ejecución:** 2026-05-18  
**Commit de referencia:** `f2c6642` (main)  
**Ejecutado por:** CEO Agent (GitHub Copilot)  
**Estado:** ✅ COMPLETADO — Ambiente staging validado completamente

---

## Resultado General

```
✅ EJECUCIÓN SQL EXITOSA EN STAGING
Proyecto: etl-v1-staging
Ref:       skrjyrnprmoattwlitzs
Región:    us-west-2
URL:       https://skrjyrnprmoattwlitzs.supabase.co

Scripts ejecutados:  7/7 (Scripts 0-6)
Tablas creadas:      14
Columnas críticas:   8/8 verificadas
RLS habilitada en:   6 tablas
Políticas RLS:       15
Seed mínimo:         5 registros en 5 tablas
Tests locales:       141/141 ✅
Build:               ✓ Compiled successfully ✅
```

---

## 1. Estado Local Verificado

```
Branch: main
HEAD: f2c6642 — feat: Task 10 - pre-staging analysis and env setup
Tests: 141/141 passing
Build: ✓ Compiled successfully
Archivo: apps/web/.env.staging.local (gitignored ✅)
```

---

## 2. Proyecto Supabase Staging Creado

| Campo | Valor |
|-------|-------|
| Nombre | etl-v1-staging |
| Project ref | `skrjyrnprmoattwlitzs` |
| URL | `https://skrjyrnprmoattwlitzs.supabase.co` |
| Región | us-west-2 |
| Organización | soluctionssas-create's Org |
| Estado | ACTIVO ✅ |

### Separación Producción vs Staging

| Proyecto | Ref | Estado |
|----------|-----|--------|
| Producción | `pvzchcscuqpzuaxbfihh` | ⛔ NO TOCAR |
| Staging | `skrjyrnprmoattwlitzs` | ✅ VALIDADO |

---

## 3. Scripts SQL Ejecutados

| # | Script | Resultado | Tablas Creadas |
|---|--------|-----------|----------------|
| 0 | `SUPABASE_AUTH_SETUP.md` (bloque SQL) | ✅ Success | `tenants`, `users`, `invoices` (base) |
| 1 | `supabase_core_app_tables.sql` | ✅ Success | `batches` + extensiones `invoices` |
| 2 | `supabase_facturacion_dian_es.sql` | ✅ Success | `facturas_dian`, `facturas_dian_detalle` |
| 3 | `supabase_batches_tenant_migration.sql` | ✅ Success | Añade `tenant_id` a `batches` |
| 4 | `supabase_tax_calculation_results.sql` | ✅ Success | `invoice_tax_calculations`, `invoice_line_classifications`, `invoice_tax_calculation_groups` |
| 5 | `supabase_tenant_memory.sql` | ✅ Success | `tenant_supplier_memory`, `tenant_accounting_patterns`, `tenant_reclassification_audit`, `accounting_movements_import`, `tenant_tax_classification_memory` |
| 6 | `supabase_rls_policies.sql` | ✅ Success | RLS + 15 políticas en 6 tablas |

---

## 4. Verificación de Tablas (14 tablas)

```sql
-- Resultado: 14 rows
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

| Tabla | Estado |
|-------|--------|
| accounting_movements_import | ✅ |
| batches | ✅ |
| facturas_dian | ✅ |
| facturas_dian_detalle | ✅ |
| invoice_line_classifications | ✅ |
| invoice_tax_calculation_groups | ✅ |
| invoice_tax_calculations | ✅ |
| invoices | ✅ |
| tenant_accounting_patterns | ✅ |
| tenant_reclassification_audit | ✅ |
| tenant_supplier_memory | ✅ |
| tenant_tax_classification_memory | ✅ |
| tenants | ✅ |
| users | ✅ |

**Total: 14 tablas ✅**

---

## 5. Verificación de Columnas Críticas (8/8)

```sql
-- Resultado: 8 rows
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND (
  (table_name='invoice_tax_calculations' AND column_name IN ('invoice_id','factura_dian_id','tenant_id','batch_id'))
  OR (table_name='batches' AND column_name='tenant_id')
  OR (table_name='invoices' AND column_name='tenant_id')
  OR (table_name='facturas_dian' AND column_name='tenant_id')
  OR (table_name='tenant_supplier_memory' AND column_name='tenant_id')
)
ORDER BY table_name, column_name;
```

| Tabla | Columna | Estado |
|-------|---------|--------|
| batches | tenant_id | ✅ |
| facturas_dian | tenant_id | ✅ |
| invoice_tax_calculations | batch_id | ✅ |
| invoice_tax_calculations | factura_dian_id | ✅ |
| invoice_tax_calculations | invoice_id | ✅ |
| invoice_tax_calculations | tenant_id | ✅ |
| invoices | tenant_id | ✅ |
| tenant_supplier_memory | tenant_id | ✅ |

**Total: 8/8 columnas críticas ✅**

---

## 6. RLS Habilitada (6 tablas)

```sql
-- Resultado: 6 tablas con relrowsecurity = true
SELECT relname FROM pg_class
WHERE relrowsecurity = true AND relkind = 'r'
AND relname NOT LIKE 'pg_%'
ORDER BY relname;
```

| Tabla | RLS |
|-------|-----|
| batches | ✅ ENABLED |
| facturas_dian | ✅ ENABLED |
| facturas_dian_detalle | ✅ ENABLED |
| invoices | ✅ ENABLED |
| tenants | ✅ ENABLED |
| users | ✅ ENABLED |

**Total: 6 tablas con RLS ✅**

---

## 7. Políticas RLS (15 políticas)

```sql
-- Resultado: 15 rows
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**Total: 15 políticas verificadas ✅**

---

## 8. Seed Mínimo

| Tabla | Registros | ID |
|-------|-----------|-----|
| tenants | 1 | `00000000-0000-0000-0000-000000000001` |
| batches | 1 | `00000000-0000-0000-0000-000000000010` |
| invoices | 1 | `00000000-0000-0000-0000-000000000100` |
| facturas_dian | 1 | `00000000-0000-0000-0000-000000000200` |
| invoice_tax_calculations | 1 | `00000000-0000-0000-0000-000000000300` |

### Error Resuelto en Seed

**Error:** `ERROR: 23502: null value in column "filename" of relation "batches" violates not-null constraint`  
**Causa:** `batches.filename` es NOT NULL — el INSERT inicial lo omitió.  
**Solución:** Incluir `filename = 'seed-test.zip'` en el INSERT.

---

## 9. Tests Locales

```
Test Files  8 passed (8)
      Tests  141 passed (141)
   Start at  14:04:11
   Duration  1.79s
```

**141/141 ✅ — Sin regresiones**

---

## 10. Build

```
✓ Compiled successfully in 8.5s
```

**Build limpio ✅**

---

## 11. Aprobación SQL para Producción

El ambiente staging ha sido validado completamente. El SQL está **APROBADO** para
ejecución en producción (`pvzchcscuqpzuaxbfihh`) cuando el usuario lo autorice.

**Pendiente:** Autorización explícita del usuario para ejecutar los 7 scripts en producción.

---

## 12. Errores Encontrados y Correcciones

| Error | Causa | Solución |
|-------|-------|---------|
| `batches.filename` NOT NULL constraint | INSERT de seed omitió columna requerida | Se añadió `filename = 'seed-test.zip'` al INSERT |

---

## 13. Estado Final

```
✅ etl-v1-staging (skrjyrnprmoattwlitzs)
   └── 14 tablas creadas
   └── 8 columnas críticas verificadas
   └── 6 tablas con RLS habilitada
   └── 15 políticas RLS activas
   └── 5 registros seed
   └── 141/141 tests passing
   └── Build: ✓ Compiled successfully

⛔ pvzchcscuqpzuaxbfihh (PRODUCCIÓN)
   └── NO MODIFICADO — Pendiente aprobación
