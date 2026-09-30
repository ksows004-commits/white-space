import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { BatchPart } from "@/lib/types";

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("inspection_batches")
    .select("id, created_at, parts")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "찾을 수 없음" }, { status: 404 });
  }

  const parts = data.parts as BatchPart[];
  const header = [
    "serial_number",
    "worst_judgment",
    "affected_panel_id",
    "defect_x_mm",
    "defect_y_mm",
    "defect_z_mm",
    "defect_sqrt_area_um",
    "defect_location",
    "usable_zone_count",
    "total_zone_count",
  ];

  const rows = parts.map((p) =>
    [
      p.serial_number,
      p.summary.worst_judgment,
      p.summary.affected_panel_id ?? "",
      p.defect?.x_mm ?? "",
      p.defect?.y_mm ?? "",
      p.defect?.z_mm ?? "",
      p.defect?.sqrt_area_um ?? "",
      p.defect?.location ?? "",
      p.summary.usable_zone_count ?? "",
      p.summary.total_zone_count ?? "",
    ]
      .map(csvEscape)
      .join(",")
  );

  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 앞에 붙인다.
  const csv = "﻿" + [header.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="batch-${id}.csv"`,
    },
  });
}
