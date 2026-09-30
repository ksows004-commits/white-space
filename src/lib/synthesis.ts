import Anthropic from "@anthropic-ai/sdk";
import type { BatchPart } from "./types";

const anthropic = new Anthropic();

export async function generateSynthesis(parts: BatchPart[]): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildSynthesisPrompt(parts) }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}

function buildSynthesisPrompt(parts: BatchPart[]): string {
  const judgmentCounts = { Pass: 0, "Conditional Pass": 0, Fail: 0 };
  for (const p of parts) {
    judgmentCounts[p.summary.worst_judgment]++;
  }

  const partLines = parts
    .map((p) => {
      if (p.defect.length === 0) return `${p.serial_number}: 결함 없음, 판정 ${p.summary.worst_judgment}`;
      const defects = p.defect
        .map((d) => `위치 ${d.panel_id}(${d.location}, √area ${d.sqrt_area_um}μm, ${d.judgment})`)
        .join(", ");
      return `${p.serial_number}: ${defects} → 최종 판정 ${p.summary.worst_judgment}`;
    })
    .join("\n");

  return `당신은 발사체 부품 제조 공정을 검토하는 품질관리 책임자입니다.
아래는 이번 검사 회차에서 검사한 부품 ${parts.length}개의 결함 및 판정 결과입니다.
다른 숫자나 공정 정보를 지어내지 말고, 아래 데이터만 근거로 패턴을 분석하세요.

[전체 판정 요약]
Pass ${judgmentCounts.Pass}개, Conditional Pass ${judgmentCounts["Conditional Pass"]}개, Fail ${judgmentCounts.Fail}개

[부품별 결함 정보]
${partLines}

다음을 포함해 한국어로 300자 내외 종합 분석을 작성하세요:
1. 이번 회차의 전체 결과 요약
2. 여러 부품에서 결함이 같거나 인접한 구역(panel_id)에 반복해서 나타나는지 확인하고,
   반복된다면 "공정 문제(예: 특정 공정 단계나 금형 문제)"를 의심할 근거로 제시
3. 결함 위치가 부품마다 제각각이면 "공정 문제로 보기 어렵고 개별 재료 품질 편차"로
   판단한다고 명시
4. 위에 주어진 데이터만 근거로 삼고, 실제 공정 정보를 지어내지 마세요.`;
}
