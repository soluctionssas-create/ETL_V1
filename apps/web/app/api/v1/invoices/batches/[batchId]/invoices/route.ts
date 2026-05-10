import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await context.params;
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(request.nextUrl.searchParams.get("page_size") ?? "50");
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  const from = Math.max(0, (page - 1) * pageSize);
  const to = from + pageSize - 1;

  const { data, count, error } = await supabase
    .from("invoices")
    .select("id, batch_id, invoice_number, vendor_name, vendor_tax_id, total_amount, tax_amount, currency, status", { count: "exact" })
    .eq("batch_id", batchId)
    .range(from, to)
    .order("created_at", { ascending: false });

  if (error) {
    // If invoices table/schema does not match expected contract, return empty data.
    return NextResponse.json({ total: 0, page, page_size: pageSize, items: [] });
  }

  return NextResponse.json({
    total: count ?? (data?.length ?? 0),
    page,
    page_size: pageSize,
    items: data ?? [],
  });
}
