import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { batch_id?: string; erp_system?: string };

  if (!body.batch_id || !body.erp_system) {
    return NextResponse.json({ detail: "batch_id and erp_system are required" }, { status: 400 });
  }

  return NextResponse.json({
    id: crypto.randomUUID(),
    erp_system: body.erp_system,
    status: "queued",
    total_records: 0,
    exported_records: 0,
    error_message: null,
  });
}
