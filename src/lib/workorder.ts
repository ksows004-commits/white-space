import Anthropic from "@anthropic-ai/sdk";
import type { JudgeResult } from "./types";
import { getReassignmentCandidates, buildGroundingContext } from "./report";

const anthropic = new Anthropic();

export async function generateWorkOrder(result: JudgeResult, serialNumber: string): Promise<string> {
  const candidates = result.summary.worst_judgment !== "Pass"
    ? getReassignmentCandidates(result.reassignment, 3) : [];
  const prompt = `당신은 발사체 부품 재배치 작업지시서를 작성하는 담당자입니다.
아래 계산된 데이터만 근거로 삼아, 다른 숫자를 지어내지 말고 작업지시서를 작성하세요.

[부품번호]
${serialNumber}

${buildGroundingContext(result)}

[재배치 후보 구역 (응력 낮은 순)]
${candidates.length > 0
    ? candidates.map((c) => `${c.panel_id}: ${c.von_mises_mpa} MPa (${c.judgment})`).join("\n")
    : "해당 없음(재배치 가능 구역 없음 또는 정상 판정)"}

다음 형식으로 한국어 작업지시서를 작성하세요 (각 항목 한두 문장, 전체 250자 내외):
부품번호: ${serialNumber}
판정: (Pass/Conditional Pass/Fail)
권장 조치: (재배치 후보 구역을 구체적으로 제시하고, 비정상 판정인데 재배치 불가 시 폐기 검토를 명시)
승인 필요 사항: (레벨3 검사원의 최종 승인이 필요한 부분을 명시)
비고: (특이사항, 없으면 "없음")

주어진 수치만 사용하고, 주어지지 않은 정보는 지어내지 마세요.`;
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5", max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}
