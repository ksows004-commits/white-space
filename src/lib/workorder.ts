import Anthropic from "@anthropic-ai/sdk";
import type { JudgeResult } from "./types";
import { buildGroundingContext } from "./report";

const anthropic = new Anthropic();

export async function generateWorkOrder(result: JudgeResult, serialNumber: string): Promise<string> {
  const prompt = `당신은 발사체 부품 재배치 작업지시서를 작성하는 담당자입니다.
아래 계산된 데이터만 근거로 삼아, 다른 숫자를 지어내지 말고 작업지시서를 작성하세요.
이 부품은 조립 전 검사 대상이라 "폐기할지"가 아니라 "어느 방향/위치로 설치할지"를
정하는 게 목적입니다.

[부품번호]
${serialNumber}

${buildGroundingContext(result)}

다음 형식으로 한국어 작업지시서를 작성하세요 (각 항목 한두 문장, 전체 250자 내외):
부품번호: ${serialNumber}
판정: (Pass/Conditional Pass/Fail)
권장 조치: (Conditional Pass면 위 [사용 가능한 구역 예시]에 나온 구역 이름을 구체적으로
제시해 그 방향/위치로 설치하도록 지시. Fail이면 모든 구역에서 사용 불가하므로 폐기
검토를 명시. 예시에 없는 구역 이름을 지어내지 마세요.)
승인 필요 사항: (레벨3 검사원의 최종 설치 방향 확정 및 승인이 필요함을 명시)
비고: (특이사항, 없으면 "없음")

주어진 수치만 사용하고, 주어지지 않은 정보는 지어내지 마세요.`;
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5", max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}
