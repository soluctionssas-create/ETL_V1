/**
 * Monitor de errores HTTP para rutas de API server-side (Next.js App Router).
 *
 * Uso:
 *   import { logApiError, logApiRequest } from "@/lib/server/monitor";
 *
 *   // En un route handler:
 *   logApiError(500, req, "Error al consultar Supabase", err);
 *
 * Los logs aparecen en Vercel → Deployment → Runtime Logs.
 * Filtrar por "[MONITOR_ERROR]" o "[MONITOR_REQUEST]" para aislar.
 */

/** Niveles de severidad para filtrado en logs */
export type LogLevel = "info" | "warn" | "error";

export interface MonitorContext {
  tenantId?: string | null;
  correlationId?: string | null;
  userId?: string | null;
  [key: string]: unknown;
}

/**
 * Registra errores HTTP 4xx/5xx en los logs de Vercel con contexto estructurado.
 *
 * @param status     Código HTTP de la respuesta (ej. 404, 500)
 * @param path       Ruta de la API (ej. "/api/v1/invoices/batches")
 * @param message    Mensaje descriptivo del error
 * @param context    Contexto adicional (tenant, correlationId, etc.)
 */
export function logApiError(
  status: number,
  path: string,
  message: string,
  context: MonitorContext = {}
): void {
  if (status < 400) return; // Solo 4xx y 5xx

  const level: LogLevel = status >= 500 ? "error" : "warn";
  const tag = level === "error" ? "[MONITOR_ERROR]" : "[MONITOR_WARN]";

  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    status,
    path,
    message,
    ...context,
  });

  if (level === "error") {
    console.error(`${tag} ${status} ${path}`, entry);
  } else {
    console.warn(`${tag} ${status} ${path}`, entry);
  }
}

/**
 * Registra requests entrantes para trazabilidad (solo en modo debug/staging).
 * En producción evitar loguear todos los requests para no exceder cuotas de logs.
 *
 * @param method   Método HTTP
 * @param path     Ruta de la API
 * @param context  Contexto (tenant, correlationId)
 */
export function logApiRequest(
  method: string,
  path: string,
  context: MonitorContext = {}
): void {
  // Solo loguear si DEBUG_MONITORING está activo
  if (process.env.DEBUG_MONITORING !== "true") return;

  console.info(
    `[MONITOR_REQUEST] ${method} ${path}`,
    JSON.stringify({
      ts: new Date().toISOString(),
      method,
      path,
      ...context,
    })
  );
}
