import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

async function getTenantIdFromRequest(
  request: NextRequest,
  supabase: ReturnType<typeof getSupabaseAdminClient>
): Promise<string | null> {
  if (!supabase) return null;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      const { data: userRecord } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      const rec = userRecord as { tenant_id?: string } | null;
      if (rec?.tenant_id) return rec.tenant_id;
    }
  }

  // Fallback: primer tenant disponible (single-tenant deployments)
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (tenant as { id?: string } | null)?.id ?? null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await context.params;
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ detail: "Batch not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("batches")
    .select("id, filename, file_size, file_type, status, total_invoices, processed_invoices, failed_invoices, celery_task_id, error_message, tenant_id")
    .eq("id", batchId)
    .single();

  if (error || !data) {
    return NextResponse.json({ detail: "Batch not found" }, { status: 404 });
  }

  // Validar que el batch pertenece al tenant del usuario autenticado.
  const batchRecord = data as { tenant_id?: string | null } & typeof data;
  if (batchRecord.tenant_id) {
    const tenantId = await getTenantIdFromRequest(request, supabase);
    if (tenantId && batchRecord.tenant_id !== tenantId) {
      return NextResponse.json({ detail: "Batch not found" }, { status: 404 });
    }
  }

  return NextResponse.json(data);
}
