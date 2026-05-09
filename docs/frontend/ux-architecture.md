# Frontend Architecture

## Stack UI

- Next.js App Router + TypeScript.
- Server Components para vistas de lectura.
- Client Components para formularios y acciones.

## Paginas

- `/` Landing operativa.
- `/dashboard` KPIs y estado de lotes.
- `/invoices` bandeja y filtros.
- `/invoices/upload` carga masiva.
- `/classifications` revision IA.
- `/exports` estado de exportaciones.
- `/settings` tenant, usuarios, reglas.

## Wireframe (bajo nivel)

```text
+-----------------------------------------------------------+
| Sidebar | Header (Tenant, Search, User)                  |
|         +-----------------------------------------------+ |
|         | KPI cards: Procesadas | Pendientes | Error     | |
|         +-----------------------------------------------+ |
|         | Tabla lotes: id | fecha | estado | acciones    | |
|         +-----------------------------------------------+ |
|         | Cola de jobs y alertas                          |
|         +-----------------------------------------------+ |
+-----------------------------------------------------------+
```

## Requisitos UX

- Responsive mobile-first.
- Skeleton loaders en tablas.
- Manejo de errores con retry.
- WCAG 2.2 AA (teclado, ARIA, contraste).
- i18n preparado (es por defecto, en a futuro).
