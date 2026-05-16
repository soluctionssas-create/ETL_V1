# Go-Live Checklist — ETL_V1 en Supabase + Vercel

> Completar de arriba a abajo. Cada sección es un punto de no-retorno.
> Antes de pasar a la siguiente sección, todos los items deben estar marcados ✅.

---

## Sección 1 — Supabase: Proyecto y Auth

- [ ] **1.1** Proyecto Supabase creado (región elegida, contraseña DB guardada en gestor de secretos)
- [ ] **1.2** Dashboard → Settings → API → Copiar **Project URL** y guardar
- [ ] **1.3** Dashboard → Settings → API → Copiar **anon / public key** y guardar
- [ ] **1.4** Dashboard → Settings → API → Mostrar **service_role key** → copiar y guardar con máxima seguridad
- [ ] **1.5** Authentication → Sign In / Up → Email habilitado
- [ ] **1.6** Authentication → URL Configuration → Site URL = `https://etl-v1.vercel.app`
- [ ] **1.7** Authentication → URL Configuration → Redirect URLs → agregar `https://etl-v1.vercel.app/**`

---

## Sección 2 — Supabase: Ejecución SQL (en orden)

> Ir a SQL Editor → New query → pegar → Run para cada bloque.

- [ ] **2.1** Ejecutar script de `SUPABASE_AUTH_SETUP.md` (tablas: `tenants`, `users`, `invoices` base)
- [ ] **2.2** Verificar que las 3 tablas existen en Table Editor
- [ ] **2.3** Ejecutar `database/supabase_core_app_tables.sql` ← **NUEVO — corrige bloqueadores go-live**
- [ ] **2.4** Verificar que `public.batches` existe:
  ```sql
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'batches';
  -- Debe retornar 1 fila
  ```
- [ ] **2.5** Verificar columnas completadas en `public.invoices`:
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'invoices'
    AND column_name IN ('batch_id', 'vendor_name', 'vendor_tax_id', 'total_amount', 'tax_amount', 'status');
  -- Debe retornar 6 filas
  ```
- [ ] **2.6** Verificar que `public.invoices.batch_id` existe (FK hacia batches)
- [ ] **2.7** Verificar que `public.invoices.vendor_name` existe
- [ ] **2.8** Verificar que `public.invoices.total_amount` existe
- [ ] **2.9** Verificar que `public.invoices.status` existe (default: `'pending'`)
- [ ] **2.10** Ejecutar `database/supabase_facturacion_dian_es.sql`
- [ ] **2.11** Verificar que `facturas_dian`, `facturas_dian_detalle` existen
- [ ] **2.12** Ejecutar `database/supabase_batches_tenant_migration.sql`
- [ ] **2.13** Verificar columna `tenant_id` en tabla `batches`:
  ```sql
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'batches' AND column_name = 'tenant_id';
  ```
- [ ] **2.14** Ejecutar `database/supabase_rls_policies.sql`
- [ ] **2.15** Verificar que RLS está activo:
  ```sql
  SELECT tablename, rowsecurity FROM pg_tables
  WHERE schemaname = 'public'
  AND tablename IN ('batches','invoices','facturas_dian','facturas_dian_detalle');
  -- Todos deben mostrar rowsecurity = true
  ```
- [ ] **2.16** Verificar función `auth.get_tenant_id()` existe:
  ```sql
  SELECT proname FROM pg_proc WHERE proname = 'get_tenant_id';
  -- Debe devolver 1 fila
  ```
- [ ] **2.17** ⚠️ Confirmar que `database/schema.sql` NO fue ejecutado en Supabase

---

## Sección 3 — Supabase: Tenant inicial y backfill

- [ ] **3.1** Crear el primer tenant en SQL Editor:
  ```sql
  INSERT INTO public.tenants (name, slug)
  VALUES ('Mi Empresa', 'mi-empresa')
  RETURNING id;
  -- Copiar el UUID para usar en los pasos siguientes
  ```
- [ ] **3.2** Copiar UUID del tenant creado: `___________________________________`
- [ ] **3.3** Ejecutar backfill si hay batches existentes (de pruebas):
  ```sql
  UPDATE public.batches
  SET tenant_id = 'UUID_DEL_TENANT_COPIADO'
  WHERE tenant_id IS NULL;
  ```
- [ ] **3.4** Verificar backfill:
  ```sql
  SELECT COUNT(*) FILTER (WHERE tenant_id IS NULL) AS sin_tenant,
         COUNT(*) FILTER (WHERE tenant_id IS NOT NULL) AS con_tenant
  FROM public.batches;
  ```

---

## Sección 4 — Vercel: Variables de Entorno

> Vercel Dashboard → proyecto `etl-v1` → Settings → Environment Variables

| # | Variable | Tipo | Aplica a | Marcada |
|---|----------|------|----------|---------|
| 4.1 | `SUPABASE_URL` | Secret | Production + Preview + Dev | [ ] |
| 4.2 | `SUPABASE_ANON_KEY` | Secret | Production + Preview + Dev | [ ] |
| 4.3 | `SUPABASE_SERVICE_ROLE_KEY` | Secret | Production + Preview | [ ] |
| 4.4 | `NEXT_PUBLIC_SUPABASE_URL` | Plain Text | Production + Preview + Dev | [ ] |
| 4.5 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Plain Text | Production + Preview + Dev | [ ] |
| 4.6 | `NEXT_PUBLIC_API_URL` | Plain Text (valor: `/api/v1`) | Production + Preview | [ ] |

- [ ] **4.7** Confirmar que `SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_URL` tienen el mismo valor
- [ ] **4.8** Confirmar que `SUPABASE_ANON_KEY` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` tienen el mismo valor
- [ ] **4.9** Confirmar que `SUPABASE_SERVICE_ROLE_KEY` NO tiene prefijo `NEXT_PUBLIC_`
- [ ] **4.10** Confirmar que `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL` NO están en Vercel

---

## Sección 5 — Vercel: Configuración del Proyecto

> Vercel Dashboard → proyecto `etl-v1` → Settings → General

- [ ] **5.1** Root Directory = `apps/web`
- [ ] **5.2** Framework Preset = Next.js
- [ ] **5.3** Build Command = `npm run build` (o vacío para usar el default de Next.js)
- [ ] **5.4** Install Command = `npm install`
- [ ] **5.5** Node.js Version = 22.x o la más reciente LTS disponible

---

## Sección 6 — Build y Deploy Local

- [ ] **6.1** En la raíz del repositorio: `git pull` para asegurarse de estar en la última versión
- [ ] **6.2** `cd apps/web && npm install`
- [ ] **6.3** `npm run build` — debe completar sin errores (17 routes esperadas)
- [ ] **6.4** Confirmar en la salida: `✓ Compiled successfully` o `Generating static pages`
- [ ] **6.5** Si hay errores de TypeScript → corregir antes de continuar

---

## Sección 7 — Deploy a Producción

- [ ] **7.1** Opción A (script): ejecutar `deploy_vercel.bat` desde la raíz del repo
- [ ] **7.2** Opción B (manual): `cd apps/web && vercel --prod`
- [ ] **7.3** Opción C (CI/CD): push a `main` activa deploy automático en Vercel (si está configurado)
- [ ] **7.4** Verificar en Vercel Dashboard que el deployment está en estado **Ready** (no Error)
- [ ] **7.5** Abrir la URL de producción: `https://etl-v1.vercel.app`

---

## Sección 8 — Validación Funcional

- [ ] **8.1** `GET https://etl-v1.vercel.app` → responde 200 (no error 500)
- [ ] **8.2** Ir a `/register` → registrar cuenta de prueba `test1@empresa.com`
- [ ] **8.3** Confirmar email si está habilitada la verificación
- [ ] **8.4** Ir a `/login` → login exitoso con la cuenta creada
- [ ] **8.5** Dashboard carga sin errores de consola (F12 → Console)
- [ ] **8.6** Subir un archivo XML de factura DIAN → aparece en la lista de batches
- [ ] **8.7** Abrir el batch → ver facturas procesadas (no lista vacía)
- [ ] **8.8** Ver detalle DIAN de una factura → campos en español correctos
- [ ] **8.9** Verificar `fuente_archivo` y `tot_iva` en los detalles de factura

---

## Sección 9 — Validación de Aislamiento de Tenants

- [ ] **9.1** Crear segunda cuenta `test2@otraempresa.com` (diferente tenant en `public.users`)
- [ ] **9.2** Asignar `tenant_id` diferente al segundo usuario en Supabase:
  ```sql
  -- Crear segundo tenant
  INSERT INTO public.tenants (name, slug) VALUES ('Otra Empresa', 'otra-empresa') RETURNING id;
  
  -- Asignar al segundo usuario
  UPDATE public.users SET tenant_id = 'NUEVO_UUID'
  WHERE email = 'test2@otraempresa.com';
  ```
- [ ] **9.3** Login con `test2@otraempresa.com` → NO debe ver los batches de `test1@empresa.com`
- [ ] **9.4** Intentar acceder por URL directa al `batchId` del tenant 1 → debe devolver vacío o 404
- [ ] **9.5** Los batches del tenant 2 son visibles solo para el tenant 2

---

## Sección 10 — Verificación de Logs

- [ ] **10.1** Vercel Dashboard → Deployments → Functions → verificar no hay errores 500
- [ ] **10.2** Supabase Dashboard → Logs → API → verificar no hay errores 42501 (RLS violation)
- [ ] **10.3** Supabase Dashboard → Logs → Auth → verificar logins exitosos
- [ ] **10.4** No hay errores `column "tenant_id" does not exist`
- [ ] **10.5** No hay errores `Missing Supabase URL env var` en Vercel Logs

---

## Resumen de estado

Copiar y pegar en el canal de comunicación del equipo cuando todo esté completo:

```
✅ ETL_V1 Go-Live completado
Fecha: ___________
URL: https://etl-v1.vercel.app
Supabase Project: ___________
Deployado por: ___________

Secciones completadas:
  ✅ Sec. 1 — Supabase Auth
  ✅ Sec. 2 — SQL migrations
  ✅ Sec. 3 — Tenant + backfill
  ✅ Sec. 4 — Vercel env vars
  ✅ Sec. 5 — Vercel config
  ✅ Sec. 6 — Build local
  ✅ Sec. 7 — Deploy producción
  ✅ Sec. 8 — Validación funcional
  ✅ Sec. 9 — Aislamiento tenants
  ✅ Sec. 10 — Logs limpios
```

---

## Referencias

- [DEPLOYMENT.md](../DEPLOYMENT.md) — Documentación completa de arquitectura y despliegue
- [docs/supabase_rls_execution_guide.md](supabase_rls_execution_guide.md) — Guía detallada de SQL + RLS
- [apps/web/.env.example](../apps/web/.env.example) — Variables requeridas para Next.js
- [.env.example](../.env.example) — Variables completas con separación por entorno
