import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { BatchPart } from "@/lib/types";

const GPU_API_URL = process.env.GPU_API_URL ?? "http://localhost:8000";

interface UploadedDefect {
  serial_number: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  sqrt_area_um: number;
  location: "surface" | "internal";
}

// 업로드 파일 형식: serial_number,x_mm,y_mm,z_mm,sqrt_area_um,location (헤더 1줄 + 부품별 1줄)
function parseCsv(text: string): UploadedDefect[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  const required = ["serial_number", "x_mm", "y_mm", "z_mm", "sqrt_area_um", "location"];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new Error(`CSV에 "${col}" 열이 없습니다. 필요한 열: ${required.join(", ")}`);
    }
  }
  const idx = Object.fromEntries(required.map((col) => [col, header.indexOf(col)]));

  return lines.slice(1).filter(Boolean).map((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    const location = cells[idx.location];
    if (location !== "surface" && location !== "internal") {
      throw new Error(`${i + 2}번째 줄: location은 surface 또는 internal이어야 합니다`);
    }
    return {
      serial_number: cells[idx.serial_number],
      x_mm: Number(cells[idx.x_mm]),
      y_mm: Number(cells[idx.y_mm]),
      z_mm: Number(cells[idx.z_mm]),
      sqrt_area_um: Number(cells[idx.sqrt_area_um]),
      location,
    };
  });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file 필드가 필요합니다" }, { status: 400 });
  }

  let defects: UploadedDefect[];
  try {
    defects = parseCsv(await file.text());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "CSV 파싱 실패" },
      { status: 400 }
    );
  }

  let parts: BatchPart[];
  try {
    const gpuResponse = await fetch(`${GPU_API_URL}/judge_defects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defects }),
    });
    if (!gpuResponse.ok) {
      const body = await gpuResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: body.detail ?? `GPU 서버 판정 실패 (${gpuResponse.status})` },
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
