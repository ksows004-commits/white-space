import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { BatchPart } from "@/lib/types";

const GPU_API_URL = process.env.GPU_API_URL ?? "http://localhost:8000";

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

// 새 회차 실행: GPU 서버에 10개(기본값) 배치 검사를 요청하고, 결과를 Supabase에 저장
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const count = body.count ?? 10;
  const seed = body.seed ?? Math.floor(Math.random() * 1_000_000);

  let parts: BatchPart[];
  try {
    const gpuResponse = await fetch(`${GPU_API_URL}/judge_batch?count=${count}&seed=${seed}`);
    if (!gpuResponse.ok) {
      const body = await gpuResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: body.detail ?? `GPU 서버 배치 판정 실패 (${gpuResponse.status})` },
        { status: 502 }
      );
    }
    const result = await gpuResponse.json();
    parts = result.parts;
  } catch {
    return NextResponse.json(
      { error: "GPU 서버에 연결할 수 없습니다. SSH 터널이 열려 있는지 확인하세요." },
      { status: 502 }
    );
  }

  const { data, error } = await supabase
    .from("inspection_batches")
    .insert({ parts })
    .select("id, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id, created_at: data.created_at, part_count: parts.length });
}
