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
  hv?: number;
}

type ParsedRow =
  | { kind: "defect"; defect: UploadedDefect }
  | { kind: "no_defect"; serial_number: string };

// 업로드 파일 형식: serial_number,x_mm,y_mm,z_mm,sqrt_area_um,location[,hv]
// (헤더 1줄 + 결함별 1줄. 같은 serial_number가 여러 줄이면 "부품 하나에 결함
// 여러 개"로 처리됨. hv 열은 선택 — 실측 경도값 없으면 생략 가능, 기본값 400.
// x_mm~location 칸을 전부 비워두면 "이 부품은 검사했지만 결함 없음"으로 처리됨.)
function parseCsv(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  const required = ["serial_number", "x_mm", "y_mm", "z_mm", "sqrt_area_um", "location"];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new Error(`CSV에 "${col}" 열이 없습니다. 필요한 열: ${required.join(", ")}`);
    }
  }
  const idx = Object.fromEntries(header.map((col, i) => [col, i]));
  const hasHv = header.includes("hv");

  return lines.slice(1).filter(Boolean).map((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    const serial_number = cells[idx.serial_number];
    const defectFields = [
      cells[idx.x_mm], cells[idx.y_mm], cells[idx.z_mm],
      cells[idx.sqrt_area_um], cells[idx.location],
    ];
    const allBlank = defectFields.every((c) => !c);
    if (allBlank) {
      return { kind: "no_defect", serial_number };
    }
    const location = cells[idx.location];
    if (location !== "surface" && location !== "internal") {
      throw new Error(
        `${i + 2}번째 줄: location은 surface 또는 internal이어야 합니다` +
        `(결함 없음으로 표시하려면 결함 관련 칸을 전부 비워두세요)`
      );
    }
    return {
      kind: "defect",
      defect: {
        serial_number,
        x_mm: Number(cells[idx.x_mm]),
        y_mm: Number(cells[idx.y_mm]),
        z_mm: Number(cells[idx.z_mm]),
        sqrt_area_um: Number(cells[idx.sqrt_area_um]),
        location,
        ...(hasHv && cells[idx.hv] ? { hv: Number(cells[idx.hv]) } : {}),
      },
    };
  });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file 필드가 필요합니다" }, { status: 400 });
  }

  let rows: ParsedRow[];
  try {
    rows = parseCsv(await file.text());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "CSV 파싱 실패" },
      { status: 400 }
    );
  }

  // CSV에 등장한 순서대로 serial_number 유지(첫 등장 기준)
  const serialOrder: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const serial = row.kind === "defect" ? row.defect.serial_number : row.serial_number;
    if (!seen.has(serial)) {
      seen.add(serial);
      serialOrder.push(serial);
    }
  }

  const defects = rows
    .filter((r): r is Extract<ParsedRow, { kind: "defect" }> => r.kind === "defect")
    .map((r) => r.defect);
  const noDefectSerials = rows
    .filter((r): r is Extract<ParsedRow, { kind: "no_defect" }> => r.kind === "no_defect")
    .map((r) => r.serial_number);

  const partsBySerial = new Map<string, BatchPart>();

  try {
    if (defects.length > 0) {
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
      for (const part of result.parts as BatchPart[]) {
        partsBySerial.set(part.serial_number, part);
      }
    }

    if (noDefectSerials.length > 0) {
      // 결함 없음 = 시나리오 A(결함 없음)와 동일한 판정. GPU/judge.py를 다시
      // 건드리지 않고 이미 있는 /judge/a 엔드포인트를 재사용(116개 구역
      // 전부 사용 가능한 결과를 그대로 복사해 각 serial_number에 붙임).
      const gpuResponse = await fetch(`${GPU_API_URL}/judge/a`);
      if (!gpuResponse.ok) {
        const body = await gpuResponse.json().catch(() => ({}));
        return NextResponse.json(
          { error: body.detail ?? `GPU 서버 판정 실패 (${gpuResponse.status})` },
          { status: 502 }
        );
      }
      const noDefectResult = await gpuResponse.json();
      for (const serial of noDefectSerials) {
        if (partsBySerial.has(serial)) continue; // 같은 serial에 결함 줄도 있으면 결함 쪽 우선
        partsBySerial.set(serial, {
          serial_number: serial,
          panels: noDefectResult.panels,
          reassignment: noDefectResult.reassignment,
          defect: noDefectResult.defect,
          summary: noDefectResult.summary,
        });
      }
    }
  } catch {
    return NextResponse.json(
      { error: "GPU 서버에 연결할 수 없습니다. SSH 터널이 열려 있는지 확인하세요." },
      { status: 502 }
    );
  }

  const parts: BatchPart[] = serialOrder
    .map((serial) => partsBySerial.get(serial))
    .filter((part): part is BatchPart => Boolean(part));

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
