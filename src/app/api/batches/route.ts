import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { BatchPart } from "@/lib/types";

// 회차 목록 (최신순)
export async function GET() {
  const { data, error } = await supabase
    .from("inspection_batches")
    .select("id, created_at, parts")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const batches = (data ?? []).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    part_count: (row.parts as BatchPart[]).length,
  }));

  return NextResponse.json({ batches });
}
