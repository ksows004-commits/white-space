import Anthropic from "@anthropic-ai/sdk";
import type { Anthropic as AnthropicTypes } from "@anthropic-ai/sdk";
import type { BatchPart, JudgeResult, Judgment, Panel } from "./types";
import { supabase } from "./supabase";

export const GET_CANDIDATES_TOOL = {
  name: "get_reassignment_candidates",
  description: "이 부품의 결함을 재배치할 수 있는 후보 구역을 응력이 낮은 순으로 조회합니다. 판정이 Conditional Pass 또는 Fail일 때, 구체적으로 어느 구역에 재배치 가능한지 리포트에 언급하기 전에 사용하세요.",
  input_schema: {
    type: "object" as const,
    properties: {
      limit: { type: "number", description: "가져올 후보 구역 개수 (기본 3)" },
    },
  },
};

export const GET_SIMILAR_TOOL = {
  name: "get_similar_past_inspections",
  description: "이 부품의 결함과 위치·크기가 비슷한 과거 검사 이력을 조회합니다. 리포트에 '과거에도 비슷한 결함이 있었다' 같은 맥락을 넣고 싶을 때 사용하세요. 이력이 없으면 빈 배열이 돌아오니 그럴 땐 지어내지 말고 언급을 생략하세요.",
  input_schema: {
    type: "object" as const,
    properties: {
      limit: { type: "number", description: "가져올 유사 이력 개수 (기본 3)" },
    },
  },
};

const anthropic = new Anthropic();

export async function getSimilarPastInspections(
  currentSerial: string | undefined,
  location: string,
  sqrtAreaUm: number,
  limit = 3
) {
  const { data, error } = await supabase
    .from("inspection_batches")
    .select("parts")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);

  const candidates: {
    serial_number: string;
    location: string;
    sqrt_area_um: number;
    judgment: Judgment;
  }[] = [];
  for (const batch of data ?? []) {
    for (const part of (batch.parts ?? []) as BatchPart[]) {
      if (part.serial_number === currentSerial) continue;
      for (const defect of part.defect) {
        if (defect.location === location) {
          candidates.push({
            serial_number: part.serial_number,
            location: defect.location,
            sqrt_area_um: defect.sqrt_area_um,
            judgment: defect.judgment,
          });
        }
      }
    }
  }
  return candidates
    .sort((a, b) => Math.abs(a.sqrt_area_um - sqrtAreaUm) - Math.abs(b.sqrt_area_um - sqrtAreaUm))
    .slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3);
}

export function getReassignmentCandidates(reassignment: Panel[], limit: number = 3) {
  return reassignment
    .filter((p) => p.judgment !== "Fail")
    .sort((a, b) => a.von_mises_mpa - b.von_mises_mpa)
    .slice(0, limit)
    .map((p) => ({ panel_id: p.panel_id, von_mises_mpa: p.von_mises_mpa, judgment: p.judgment }));
}

export async function generateReport(result: JudgeResult, currentSerialNumber?: string): Promise<{ report: string; verified: boolean; issues: string[] }> {
  const messages: AnthropicTypes.MessageParam[] = [
    { role: "user", content: buildPrompt(result) },
  ];

  const MAX_TOOL_ROUNDS = 3;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      tools: [GET_CANDIDATES_TOOL, GET_SIMILAR_TOOL],
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      const reportText = textBlock?.type === "text" ? textBlock.text : "";
      const { verified, issues } = await verifyReport(result, reportText, currentSerialNumber);
      return { report: reportText, verified, issues };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: AnthropicTypes.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "get_reassignment_candidates") {
        const limit = (block.input as { limit?: number }).limit ?? 3;
        const candidates = getReassignmentCandidates(result.reassignment, limit);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(candidates),
        });
      } else if (block.type === "tool_use" && block.name === "get_similar_past_inspections") {
        const limit = (block.input as { limit?: number }).limit ?? 3;
        const severity: Record<Judgment, number> = { Pass: 0, "Conditional Pass": 1, Fail: 2 };
        const worstDefect = result.defect.reduce<(typeof result.defect)[number] | undefined>(
          (worst, defect) => !worst || severity[defect.judgment] > severity[worst.judgment] ? defect : worst,
          undefined
        );
        try {
          const inspections = worstDefect
            ? await getSimilarPastInspections(currentSerialNumber, worstDefect.location, worstDefect.sqrt_area_um, limit)
            : [];
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(inspections),
          });
        } catch {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: "과거 검사 이력 조회에 실패했습니다. 과거 이력을 지어내지 말고 언급을 생략하세요.",
          });
        }
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  const finalResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages,
  });
  const textBlock = finalResponse.content.find((b) => b.type === "text");
  const reportText = textBlock?.type === "text" ? textBlock.text : "";
  const { verified, issues } = await verifyReport(result, reportText, currentSerialNumber);
  return { report: reportText, verified, issues };
}

export function buildGroundingContext({ summary, defect, panels }: JudgeResult): string {
  const affectedPanel = panels.find((p) => p.panel_id === summary.affected_panel_id);

  const defectDescription =
    defect.length === 0
      ? "결함 없음"
      : defect
          .map(
            (d, i) =>
              `결함 ${i + 1}: 위치(x=${d.x_mm}mm, y=${d.y_mm}mm, z=${d.z_mm}mm), 크기(√area) ${d.sqrt_area_um}μm, 종류: ${d.location === "surface" ? "표면" : "내부"}, 이 결함만의 판정: ${d.judgment}`
          )
          .join("\n");

  const reassignmentDescription =
    summary.usable_zone_count !== undefined && summary.total_zone_count !== undefined
      ? `전체 ${summary.total_zone_count}개 구역 중 ${summary.usable_zone_count}개 구역에서 사용 가능(Fail이 아님)`
      : "재배치 가능 구역 정보 없음";

  return `[결함 정보 (${defect.length}개)]
${defectDescription}

[최종 판정]
${summary.worst_judgment} (영향받은 구역: ${summary.affected_panel_id ?? "없음"})

[해당 구역 응력]
${affectedPanel ? `${affectedPanel.von_mises_mpa} MPa` : "정보 없음"}

[재배치 가능 범위]
${reassignmentDescription}`;
}

export async function verifyReport(
  result: JudgeResult, reportText: string, currentSerialNumber?: string
): Promise<{ verified: boolean; issues: string[] }> {
  // 리포트 작성자는 get_reassignment_candidates/get_similar_past_inspections 도구도
  // 쓸 수 있었으므로, 검증자도 같은 조회 결과를 봐야 "도구로 확인한 내용"을
  // 근거 없다고 잘못 판단하지 않는다.
  const candidates = getReassignmentCandidates(result.reassignment, 3);
  const severity: Record<Judgment, number> = { Pass: 0, "Conditional Pass": 1, Fail: 2 };
  const worstDefect = result.defect.reduce<(typeof result.defect)[number] | undefined>(
    (worst, defect) => !worst || severity[defect.judgment] > severity[worst.judgment] ? defect : worst,
    undefined
  );
  let similarInspections: Awaited<ReturnType<typeof getSimilarPastInspections>> = [];
  if (worstDefect) {
    try {
      similarInspections = await getSimilarPastInspections(
        currentSerialNumber, worstDefect.location, worstDefect.sqrt_area_um, 3
      );
    } catch {
      similarInspections = [];
    }
  }

  const prompt = `당신은 QA 검토자입니다. 아래는 계산된 판정 데이터와 그걸 바탕으로
작성된 리포트입니다. 리포트 작성자는 아래 데이터 외에 재배치 후보 구역 조회,
과거 유사 이력 조회 도구도 쓸 수 있었으므로 그 조회 결과도 근거로 인정하세요.
리포트에 언급된 수치(응력값, 구역 번호, 판정 결과 등)가 이 데이터들과 정확히
일치하는지 검토하세요. 단순 반올림 표기 차이는 문제로 지적하지 마세요.

${buildGroundingContext(result)}

[재배치 후보 구역 조회 결과 (응력 낮은 순, 참고용)]
${candidates.length > 0 ? candidates.map((c) => `${c.panel_id}: ${c.von_mises_mpa} MPa (${c.judgment})`).join("\n") : "없음"}

[과거 유사 검사 이력 조회 결과 (참고용)]
${similarInspections.length > 0 ? JSON.stringify(similarInspections) : "없음"}

[검토할 리포트]
${reportText}

첫 줄에 데이터와 일치하면 CONSISTENT, 모순이 있으면
INCONSISTENT라고만 쓰세요. INCONSISTENT면 그 다음 줄부터 문제점을 한 줄에
하나씩 "- "로 시작해서 나열하세요. 문제 없으면 첫 줄 외엔 아무것도 쓰지 마세요.`;
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5", max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock?.type === "text" ? textBlock.text : "";
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  // 모델이 결론 전에 혼잣말로 재검토하다 CONSISTENT/INCONSISTENT를 첫 줄이 아닌
  // 곳에 쓰는 경우가 있어, 정확히 일치하는 줄을 찾아 그 지점을 판정으로 삼는다.
  // 못 찾으면 안전하게 "검증 실패"로 처리(과신하지 않는 쪽으로 기본값).
  const verdictIndex = lines.findIndex((line) => {
    const upper = line.toUpperCase();
    return upper === "CONSISTENT" || upper === "INCONSISTENT";
  });
  const verified = verdictIndex !== -1 && lines[verdictIndex].toUpperCase() === "CONSISTENT";
  const issues = verdictIndex !== -1
    ? lines.slice(verdictIndex + 1).map((line) => line.replace(/^-\s*/, ""))
    : ["검증 결과를 해석할 수 없습니다 (모델 응답 형식 오류)"];
  return { verified, issues };
}

function buildPrompt(result: JudgeResult): string {
  return `당신은 발사체 부품 품질을 검토하는 레벨3 비파괴검사(NDT) 전문가입니다.
아래 계산된 데이터만 근거로 삼아, 다른 숫자를 지어내지 말고 분석 리포트를 작성하세요.
부품 하나에 결함이 여러 개일 수 있으며, 그중 가장 나쁜 판정이 부품의 최종 판정입니다.

${buildGroundingContext(result)}

다음 내용을 포함해 한국어로 200자 내외 리포트를 작성하세요:
1. 판정 결과 요약
2. 판정 근거 (응력값과 결함 정보를 바탕으로 — 결함이 여러 개면 어떤 결함이 최종 판정을
   결정했는지도 언급)
3. Conditional Pass 또는 Fail인 경우, 재배치 가능 범위(구역 수)를 근거로 이 부품을
   어디에 쓸 수 있고 어디에 쓸 수 없는지 설명
4. Fail인 경우, 왜 원래 위치에는 쓸 수 없는지
5. 판정이 Conditional Pass 또는 Fail이면, get_reassignment_candidates 도구로
   구체적인 재배치 후보 구역을 확인한 뒤 리포트에 구역 이름을 직접 언급하세요.
   도구가 반환한 구역만 언급하고, "등"처럼 도구에 없는 구역을 추가로 지어내지
   마세요.
6. get_similar_past_inspections로 과거 유사 사례를 확인할 수 있으면 리포트에 참고로
   언급하되, 도구 결과가 비어 있으면 과거 이력을 지어내지 말고 언급하지 마세요.

위에 주어진 수치만 사용하고, 주어지지 않은 정보는 지어내지 마세요.`;
}
