# Supabase + Vercel Setup

## 1) Variables de entorno en Vercel

Configura estas variables en el proyecto de Vercel (Environment Variables):

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

Puedes copiar los nombres desde `apps/web/.env.example`.

## 2) Preparar tabla y políticas en Supabase

En Supabase SQL Editor, ejecuta:

- `apps/web/supabase/setup.sql`

Esto crea `public.todos` y políticas RLS para una demo funcional inmediata.

## 3) Verificación local

1. Ejecuta `npm run dev -- --port 3010` en `apps/web`.
2. Abre `/`.
3. Crea un todo.
4. Recarga la página y valida que persiste.

## 4) Verificación en producción (Vercel)

1. Despliega el repo en Vercel.
2. Revisa que estén cargadas las variables de entorno.
3. Abre la URL de producción en `/`.
4. Crea y elimina un todo para comprobar lectura/escritura.

## 5) Recomendación de seguridad

Las políticas del archivo `setup.sql` son abiertas para acelerar validación.
Antes de pasar a productivo real, restringe políticas por usuario o tenant.
