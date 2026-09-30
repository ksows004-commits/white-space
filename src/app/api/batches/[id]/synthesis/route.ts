import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateSynthesis } from "@/lib/synthesis";
import type { BatchPart } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("inspection_batches")
    .select("parts, synthesis")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "찾을 수 없음" }, { status: 404 });
  }

  if (data.synthesis) {
    return NextResponse.json({ synthesis: data.synthesis });
  }

  const synthesis = await generateSynthesis(data.parts as BatchPart[]);
  await supabase.from("inspection_batches").update({ synthesis }).eq("id", id);

  return NextResponse.json({ synthesis });
}
