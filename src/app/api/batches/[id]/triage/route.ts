import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateReport } from "@/lib/report";
import { generateSynthesis } from "@/lib/synthesis";
import { generateWorkOrder } from "@/lib/workorder";
import { deriveJudgment } from "@/lib/types";
import type { BatchPart, Judgment } from "@/lib/types";

async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function POST(
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

  try {
    const parts = data.parts as BatchPart[];
    const pending = parts.filter(
      (part) =>
        deriveJudgment(part.summary.usable_zone_count, part.summary.total_zone_count) !== "Pass" &&
        !part.report
    );
    await mapWithConcurrency(pending, 3, async (part) => {
      const { report, verified, issues } = await generateReport(part, part.serial_number);
      part.report = report;
      part.report_verified = verified;
      part.report_issues = issues;
      part.work_order = await generateWorkOrder(part, part.serial_number);
    });
    const reportsGenerated = pending.length;
    const synthesisGenerated = !data.synthesis;
    const synthesis: string = data.synthesis || await generateSynthesis(parts);

    if (reportsGenerated > 0 || synthesisGenerated) {
      const { error: updateError } = await supabase
        .from("inspection_batches")
        .update({ parts, synthesis })
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);
    }

    const severity: Record<Judgment, number> = { Fail: 2, "Conditional Pass": 1, Pass: 0 };
    const priorityList = [...parts]
      .map((part) => ({
        part,
        judgment: deriveJudgment(part.summary.usable_zone_count, part.summary.total_zone_count),
      }))
      .sort((a, b) => severity[b.judgment] - severity[a.judgment]
        || (a.part.summary.usable_zone_count ?? Infinity) - (b.part.summary.usable_zone_count ?? Infinity))
      .map(({ part, judgment }) => {
        const usable = part.summary.usable_zone_count ?? null;
        const total = part.summary.total_zone_count ?? null;
        const reason = judgment === "Fail"
          ? "불합격 — 모든 구역에서 사용 불가, 폐기 검토 대상"
          : judgment === "Conditional Pass"
            ? `조건부 승인 — ${usable}/${total} 구역에서 사용 가능, 설치 위치 지정 필요`
            : "정상 — 모든 구역에서 사용 가능";
        return {
          serial_number: part.serial_number,
          worst_judgment: judgment,
          usable_zone_count: usable,
          total_zone_count: total,
          priority_reason: reason,
        };
      });
    return NextResponse.json({ reports_generated: reportsGenerated, synthesis, priority_list: priorityList });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "트리아지 실행 실패" },
      { status: 500 }
    );
  }
}
