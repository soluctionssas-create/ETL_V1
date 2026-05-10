import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(_: Request, context: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await context.params;
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ detail: "Batch not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("batches")
    .select("id, filename, file_size, file_type, status, total_invoices, processed_invoices, failed_invoices, celery_task_id, error_message")
    .eq("id", batchId)
    .single();

  if (error || !data) {
    return NextResponse.json({ detail: "Batch not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
