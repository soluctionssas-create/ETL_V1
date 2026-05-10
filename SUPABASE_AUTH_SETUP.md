# ✅ Setup Completo: Supabase Auth + Next.js + Vercel

## 🎯 Estado Actual

✅ **Completado:**
- Route Handlers de autenticación creados en Next.js (/api/auth/login, /api/auth/register)
- Flujo de registro y login implementado con Supabase Auth
- Build validado (✓ Compiled successfully)
- Código desplegable en Vercel

⏳ **Pendiente:**
1. Crear tablas en Supabase
2. Configurar variables de entorno en Vercel
3. Hacer test de registro

---

## 🔧 Paso 1: Crear Tablas en Supabase

1. Abre tu Supabase Dashboard: https://app.supabase.com
2. Selecciona tu proyecto
3. Ve a **SQL Editor** → **New Query**
4. Copia y pega el siguiente script:

```sql
-- Migration script to create tables for ETL SaaS
-- Run this in Supabase SQL Editor

-- ── Tenants ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tax_id TEXT,
  country_code TEXT DEFAULT 'CO',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, email)
);

-- ── Enable Row Level Security ────────────────────────────────────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ── Policies for Tenants ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant" ON tenants;
CREATE POLICY "Users can view own tenant"
ON tenants
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.tenant_id = tenants.id
    AND users.id = auth.uid()
  )
);

-- ── Policies for Users ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own tenant users" ON users;
CREATE POLICY "Users can view own tenant users"
ON users
FOR SELECT
USING (
  tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  )
);

-- ── Indexes for Performance ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ── Invoices (future use) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  amount DECIMAL(19,2) NOT NULL,
  currency TEXT DEFAULT 'COP',
  invoice_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(tenant_id, invoice_number)
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tenant invoices" ON invoices;
CREATE POLICY "Users can view own tenant invoices"
ON invoices
FOR SELECT
USING (
  tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);
```

5. Haz clic en **Run**

✅ **Resultado esperado:** Sin errores. Las tablas `tenants`, `users` e `invoices` creadas.

---

## 🔑 Paso 2: Obtener SUPABASE_SERVICE_ROLE_KEY

Este es un token que **nunca debes compartir** y **nunca debe exponerse en el frontend**.

1. En Supabase Dashboard, ve a **Settings** → **API**
2. Copia el **service_role key** (es el más largo, comienza con `eyJ`)
3. **Guárdalo en un lugar seguro**

---

## 🚀 Paso 3: Configurar Variables en Vercel

1. Ve a tu proyecto en Vercel: https://vercel.com/dashboard
2. Selecciona el proyecto `etl-v1`
3. Ve a **Settings** → **Environment Variables**
4. Agrega/Actualiza estas variables:

| Variable | Valor |
|----------|-------|
| `SUPABASE_URL` | `https://[tu-proyecto].supabase.co` (de Supabase Dashboard → Settings → API) |
| `SUPABASE_ANON_KEY` | Tu Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | El service role key del Paso 2 (⚠️ **SECRETO**) |

5. Haz clic en **Save**
6. **Redeploy**: Ve a **Deployments** → Haz clic en el último deployment → **Redeploy**

✅ **Vercel redeployará con las nuevas variables de entorno.**

---

## ✅ Paso 4: Test de Registro

**Datos de prueba:**
```
Empresa: FRUITT COL SAS
NIT: 901814874-2
Email: soluctionssas@gmail.com
Contraseña: Hola123456
Nombre Completo: Juan Camilo
```

1. Abre https://etl-v1.vercel.app/register
2. Haz clic en **"Crear cuenta"**
3. Completa el formulario:
   - **Empresa:** FRUITT COL SAS
   - **Slug empresa:** fruitt-col-sas
   - **Nombre completo:** Juan Camilo
   - **Email:** soluctionssas@gmail.com
   - **Contraseña:** Hola123456

4. Haz clic en **Registrar**

✅ **Resultado esperado:**
- Mensaje: "User registered successfully"
- Redirección a login

5. Ahora haz login con:
   - **Email:** soluctionssas@gmail.com
   - **Contraseña:** Hola123456

✅ **Resultado esperado:**
- Acceso a dashboard
- Datos de empresa visibles
- Rol: **tenant_admin**

---

## 🔐 Obtener Credenciales de Administrador

Después del primer login, el usuario es **tenant_admin** y puede:
- Ver todos los datos del tenant
- Crear y modificar usuarios
- Acceder a todas las funcionalidades

**Credenciales del administrador (FRUITT COL SAS):**
```
Email: soluctionssas@gmail.com
Contraseña: Hola123456
Rol: tenant_admin
Tenant: FRUITT COL SAS
```

---

## 🐛 Troubleshooting

### Error: "Missing SUPABASE_SERVICE_ROLE_KEY"
**Solución:** Asegúrate de configurar la variable en Vercel → Settings → Environment Variables

### Error: "Email already registered"
**Solución:** El email ya existe. Usa otro email o limpia la base de datos.

### Error: "Tenant slug already in use"
**Solución:** El slug de empresa ya existe. Usa otro slug o nombre de empresa.

### Login no funciona
**Solución:** Asegúrate de que:
1. Las tablas se crearon correctamente en Supabase
2. Las variables de entorno están configuradas en Vercel
3. Hiciste redeploy después de configurar las variables

---

## 📝 Resumen de Cambios

**Archivos creados:**
- ✅ `/apps/web/app/api/auth/register/route.ts` - Endpoint de registro
- ✅ `/apps/web/app/api/auth/login/route.ts` - Endpoint de login
- ✅ `/apps/web/supabase/migrations/0001_init_tables.sql` - Script de tablas

**Archivos modificados:**
- ✅ `/apps/web/lib/api.ts` - Rutas de auth apuntan a `/api/auth/*` (Next.js)

**Beneficios:**
- ✅ CORS resuelto (no más localhost:8000)
- ✅ Funciona en Vercel + Supabase
- ✅ Sin necesidad de backend externo para auth
- ✅ Multi-tenant integrado
- ✅ RLS (Row Level Security) implementado

---

## ✨ Próximos pasos

Después de confirmar que funciona:
1. Crear más usuarios en el tenant
2. Configurar roles y permisos
3. Implementar endpoints de negocio (invoices, batches, etc.)
4. Configurar notificaciones por email
5. Setup de observabilidad y logs

