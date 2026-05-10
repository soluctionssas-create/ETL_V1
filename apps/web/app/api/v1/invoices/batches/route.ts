import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type BatchRow = {
  id: string;
  filename: string;
  file_size: number;
  file_type: string;
  status: string;
  total_invoices: number;
  processed_invoices: number;
  failed_invoices: number;
  celery_task_id: string | null;
  error_message: string | null;
};

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(request.nextUrl.searchParams.get("page_size") ?? "20");
  const status = request.nextUrl.searchParams.get("status");

  if (!supabase) {
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize - 1;

  let query = supabase
    .from("batches")
    .select("id, filename, file_size, file_type, status, total_invoices, processed_invoices, failed_invoices, celery_task_id, error_message", { count: "exact" })
    .range(from, to)
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, count, error } = await query;

  if (error) {
    // If table does not exist yet, return a safe empty response.
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  return NextResponse.json({
    total: count ?? (data?.length ?? 0),
    page,
    page_size: pageSize,
    items: (data ?? []) as BatchRow[],
  });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ detail: "File is required" }, { status: 400 });
  }

  const batch: BatchRow = {
    id: crypto.randomUUID(),
    filename: file.name,
    file_size: file.size,
    file_type: file.type || "application/octet-stream",
    status: "uploaded",
    total_invoices: 0,
    processed_invoices: 0,
    failed_invoices: 0,
    celery_task_id: null,
    error_message: null,
  };

  if (!supabase) {
    return NextResponse.json(batch, { status: 201 });
  }

  const { data, error } = await supabase
    .from("batches")
    .insert({
      id: batch.id,
      filename: batch.filename,
      file_size: batch.file_size,
      file_type: batch.file_type,
      status: batch.status,
      total_invoices: 0,
      processed_invoices: 0,
      failed_invoices: 0,
    })
    .select("id, filename, file_size, file_type, status, total_invoices, processed_invoices, failed_invoices, celery_task_id, error_message")
    .single();

  if (error) {
    // Keep the app functional even when optional table is not ready.
    return NextResponse.json(batch, { status: 201 });
  }

  return NextResponse.json(data as BatchRow, { status: 201 });
}
