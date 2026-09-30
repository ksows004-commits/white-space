import Anthropic from "@anthropic-ai/sdk";
import type { Anthropic as AnthropicTypes } from "@anthropic-ai/sdk";
import type { JudgeResult, Panel } from "./types";

const GET_CANDIDATES_TOOL = {
  name: "get_reassignment_candidates",
  description: "이 부품의 결함을 재배치할 수 있는 후보 구역을 응력이 낮은 순으로 조회합니다. 판정이 Conditional Pass 또는 Fail일 때, 구체적으로 어느 구역에 재배치 가능한지 리포트에 언급하기 전에 사용하세요.",
  input_schema: {
    type: "object" as const,
    properties: {
      limit: { type: "number", description: "가져올 후보 구역 개수 (기본 3)" },
    },
  },
};

const anthropic = new Anthropic();

function getReassignmentCandidates(reassignment: Panel[], limit: number = 3) {
  return reassignment
    .filter((p) => p.judgment !== "Fail")
    .sort((a, b) => a.von_mises_mpa - b.von_mises_mpa)
    .slice(0, limit)
    .map((p) => ({ panel_id: p.panel_id, von_mises_mpa: p.von_mises_mpa, judgment: p.judgment }));
}

export async function generateReport(result: JudgeResult): Promise<string> {
  const messages: AnthropicTypes.MessageParam[] = [
    { role: "user", content: buildPrompt(result) },
  ];

  const MAX_TOOL_ROUNDS = 2;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      tools: [GET_CANDIDATES_TOOL],
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
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
  return textBlock?.type === "text" ? textBlock.text : "";
}

function buildPrompt({ summary, defect, panels }: JudgeResult): string {
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

  return `당신은 발사체 부품 품질을 검토하는 레벨3 비파괴검사(NDT) 전문가입니다.
아래 계산된 데이터만 근거로 삼아, 다른 숫자를 지어내지 말고 분석 리포트를 작성하세요.
부품 하나에 결함이 여러 개일 수 있으며, 그중 가장 나쁜 판정이 부품의 최종 판정입니다.

[결함 정보 (${defect.length}개)]
${defectDescription}

[최종 판정]
${summary.worst_judgment} (영향받은 구역: ${summary.affected_panel_id ?? "없음"})

[해당 구역 응력]
${affectedPanel ? `${affectedPanel.von_mises_mpa} MPa` : "정보 없음"}

[재배치 가능 범위]
${reassignmentDescription}

다음 내용을 포함해 한국어로 200자 내외 리포트를 작성하세요:
1. 판정 결과 요약
2. 판정 근거 (응력값과 결함 정보를 바탕으로 — 결함이 여러 개면 어떤 결함이 최종 판정을
   결정했는지도 언급)
3. Conditional Pass 또는 Fail인 경우, 재배치 가능 범위(구역 수)를 근거로 이 부품을
   어디에 쓸 수 있고 어디에 쓸 수 없는지 설명
4. Fail인 경우, 왜 원래 위치에는 쓸 수 없는지
5. 판정이 Conditional Pass 또는 Fail이면, get_reassignment_candidates 도구로
   구체적인 재배치 후보 구역을 확인한 뒤 리포트에 구역 이름을 직접 언급하세요.

위에 주어진 수치만 사용하고, 주어지지 않은 정보는 지어내지 마세요.`;
}
