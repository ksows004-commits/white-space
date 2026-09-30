import Anthropic from "@anthropic-ai/sdk";
import type { JudgeResult } from "./types";

const anthropic = new Anthropic();

export async function generateReport(result: JudgeResult): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(result) }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}

function buildPrompt({ summary, defect, panels }: JudgeResult): string {
  const affectedPanel = panels.find((p) => p.panel_id === summary.affected_panel_id);

  const defectDescription = defect
    ? `위치(x=${defect.x_mm}mm, y=${defect.y_mm}mm, z=${defect.z_mm}mm), 결함 크기(√area) ${defect.sqrt_area_um}μm, 위치 종류: ${defect.location === "surface" ? "표면" : "내부"}`
    : "결함 없음";

  const reassignmentDescription =
    summary.usable_zone_count !== undefined && summary.total_zone_count !== undefined
      ? `전체 ${summary.total_zone_count}개 구역 중 ${summary.usable_zone_count}개 구역에서 사용 가능(Fail이 아님)`
      : "재배치 가능 구역 정보 없음";

  return `당신은 발사체 부품 품질을 검토하는 레벨3 비파괴검사(NDT) 전문가입니다.
아래 계산된 데이터만 근거로 삼아, 다른 숫자를 지어내지 말고 분석 리포트를 작성하세요.

[결함 정보]
${defectDescription}

[최종 판정]
${summary.worst_judgment} (영향받은 구역: ${summary.affected_panel_id ?? "없음"})

[해당 구역 응력]
${affectedPanel ? `${affectedPanel.von_mises_mpa} MPa` : "정보 없음"}

[재배치 가능 범위]
${reassignmentDescription}

다음 내용을 포함해 한국어로 200자 내외 리포트를 작성하세요:
1. 판정 결과 요약
2. 판정 근거 (응력값과 결함 정보를 바탕으로)
3. Conditional Pass 또는 Fail인 경우, 재배치 가능 범위(구역 수)를 근거로 이 부품을
   어디에 쓸 수 있고 어디에 쓸 수 없는지 설명
4. Fail인 경우, 왜 원래 위치에는 쓸 수 없는지

위에 주어진 수치만 사용하고, 주어지지 않은 정보는 지어내지 마세요.`;
}
