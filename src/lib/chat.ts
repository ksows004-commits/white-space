import Anthropic from "@anthropic-ai/sdk";
import type { Anthropic as AnthropicTypes } from "@anthropic-ai/sdk";
import type { JudgeResult, Judgment } from "./types";
import {
  GET_CANDIDATES_TOOL, GET_SIMILAR_TOOL,
  getReassignmentCandidates, getSimilarPastInspections, buildGroundingContext,
} from "./report";
import { verifyReport } from "./report";
import { recordInspectorDecision } from "./decision";

const RECORD_DECISION_TOOL = {
  name: "record_inspector_decision",
  description: "검사원이 이 부품의 판정을 승인하거나 반려하겠다고 명확히 말했을 때만 사용하세요(예: '승인해줘', '이거 반려할게'). 단순히 설명이나 조언을 요청하는 경우엔 쓰지 마세요.",
  input_schema: {
    type: "object" as const,
    properties: {
      decision: { type: "string", enum: ["approved", "rejected"], description: "승인(approved) 또는 반려(rejected)" },
      note: { type: "string", description: "검사원이 남긴 사유나 메모(있으면)" },
    },
    required: ["decision"],
  },
};

const anthropic = new Anthropic();
export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  verified?: boolean;
  issues?: string[];
  showMap?: boolean;
};

export async function chatReply(
  result: JudgeResult, batchId: string, currentSerialNumber: string | undefined,
  history: ChatTurn[], userMessage: string
): Promise<{ reply: string; verified: boolean; issues: string[]; usedReassignmentTool: boolean }> {
  let usedReassignmentTool = false;
  const systemPrompt = `당신은 발사체 부품 품질을 검토하는 레벨3 비파괴검사(NDT)
전문가입니다. 아래는 이 부품에 대해 이미 계산된 데이터입니다. 사용자는 이 부품을
검토하는 검사원이고, 판정에 대해 질문합니다. 아래 데이터와 도구 결과만
근거로 답하고, 주어지지 않은 정보는 지어내지 마세요. 모르면 모른다고 답하세요.
한국어로 간결하게(한 답변당 150자 내외) 답하세요.

${buildGroundingContext(result)}`;
  const messages: AnthropicTypes.MessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: userMessage },
  ];
  const MAX_TOOL_ROUNDS = 3;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      tools: [GET_CANDIDATES_TOOL, GET_SIMILAR_TOOL, RECORD_DECISION_TOOL],
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      const replyText = textBlock?.type === "text" ? textBlock.text : "";
      const { verified, issues } = await verifyReport(result, replyText, currentSerialNumber);
      return { reply: replyText, verified, issues, usedReassignmentTool };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: AnthropicTypes.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "get_reassignment_candidates") {
        usedReassignmentTool = true;
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
      } else if (block.type === "tool_use" && block.name === "record_inspector_decision") {
        const input = block.input as { decision: "approved" | "rejected"; note?: string };
        try {
          if (!currentSerialNumber) throw new Error("serial_number가 없어 결정을 저장할 수 없습니다");
          await recordInspectorDecision(batchId, currentSerialNumber, input.decision, input.note);
          toolResults.push({ type: "tool_result", tool_use_id: block.id,
            content: `저장 완료: ${input.decision === "approved" ? "승인" : "반려"}` });
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true,
            content: err instanceof Error ? err.message : "결정 저장 실패" });
        }
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  const finalResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });
  const textBlock = finalResponse.content.find((b) => b.type === "text");
  const replyText = textBlock?.type === "text" ? textBlock.text : "";
  const { verified, issues } = await verifyReport(result, replyText, currentSerialNumber);
  return { reply: replyText, verified, issues, usedReassignmentTool };
}
