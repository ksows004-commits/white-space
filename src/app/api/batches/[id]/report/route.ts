import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateReport } from "@/lib/report";
import type { BatchPart } from "@/lib/types";

// 특정 부품의 리포트를 클릭 시점에만 생성(비용/속도 절약). 한 번 생성하면
// Supabase에 캐시해서 다음번엔 다시 Claude를 호출하지 않는다.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const serial = request.nextUrl.searchParams.get("serial");
  if (!serial) {
    return NextResponse.json({ error: "serial 쿼리 파라미터가 필요합니다" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("inspection_batches")
    .select("parts")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "찾을 수 없음" }, { status: 404 });
  }

  const parts = data.parts as BatchPart[];
  const index = parts.findIndex((p) => p.serial_number === serial);
  if (index === -1) {
    return NextResponse.json({ error: `부품을 찾을 수 없음: ${serial}` }, { status: 404 });
  }

  if (parts[index].report) {
    return NextResponse.json({ report: parts[index].report,
      verified: parts[index].report_verified, issues: parts[index].report_issues ?? [] });
  }

  const { report, verified, issues } = await generateReport(parts[index], serial);
  parts[index] = { ...parts[index], report, report_verified: verified, report_issues: issues };

  await supabase.from("inspection_batches").update({ parts }).eq("id", id);

  return NextResponse.json({ report, verified, issues });
}
