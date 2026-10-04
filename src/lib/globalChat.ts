import Anthropic from "@anthropic-ai/sdk";
import type { Anthropic as AnthropicTypes } from "@anthropic-ai/sdk";
import { deriveJudgment } from "./types";
import type { BatchPart, Panel } from "./types";
import { supabase } from "./supabase";
import type { ChatTurn } from "./chat";

export type { ChatTurn };

const LIST_BATCHES_TOOL = {
  name: "list_batches",
  description:
    "지금까지 실행된 모든 검사 회차 목록을 조회합니다. 회차별 날짜, 부품 수, " +
    "Pass/Conditional Pass/Fail 개수를 반환합니다. '전체 회차', '지금까지 검사한 것' 같은 " +
    "회차를 특정하지 않은 질문엔 먼저 이 도구로 어떤 회차들이 있는지 확인하세요.",
  input_schema: { type: "object" as const, properties: {} },
};

const GET_BATCH_RECOMMENDATIONS_TOOL = {
  name: "get_batch_recommendations",
  description:
    "특정 회차(batch_id)에 속한 모든 부품 각각에 대해, 실제로 설치할 때 추천하는 구역" +
    "(결함을 피해 응력이 가장 낮은 사용 가능 구역)과 그 근거(결함 위치 대비 응력 감소율, " +
    "거리)를 계산해서 반환합니다. 특정 회차의 부품별 설치 위치 추천, 또는 '이 회차 부품들 " +
    "어디에 쓰면 되나요' 같은 질문엔 이 도구를 사용하세요.",
  input_schema: {
    type: "object" as const,
    properties: {
      batch_id: { type: "number", description: "회차 ID (list_batches 결과의 id)" },
    },
    required: ["batch_id"],
  },
};

const anthropic = new Anthropic();

function euclideanDistanceMm(a: Panel, b: Panel): number {
  return Math.sqrt((a.x_mm - b.x_mm) ** 2 + (a.y_mm - b.y_mm) ** 2 + (a.z_mm - b.z_mm) ** 2);
}

export interface PartRecommendation {
  serial_number: string;
  judgment: ReturnType<typeof deriveJudgment>;
  usable_zone_count?: number;
  total_zone_count?: number;
  has_defect: boolean;
  recommended_panel_id?: string;
  recommended_stress_mpa?: number;
  own_defect_panel_id?: string;
  own_defect_stress_mpa?: number;
  distance_from_defect_mm?: number;
  stress_reduction_pct?: number;
  note?: string;
}

// 순수 계산 함수 — GPU 재호출 없이 이미 저장된 reassignment(116구역 전수 판정) 데이터만 사용.
export function computeBatchPositionRecommendations(parts: BatchPart[]): PartRecommendation[] {
  return parts.map((part): PartRecommendation => {
    const judgment = deriveJudgment(part.summary.usable_zone_count, part.summary.total_zone_count);
    const base = {
      serial_number: part.serial_number,
      judgment,
      usable_zone_count: part.summary.usable_zone_count,
      total_zone_count: part.summary.total_zone_count,
    };

    if (part.defect.length === 0) {
      return { ...base, has_defect: false, note: "결함 없음 — 116개 구역 전체 사용 가능" };
    }

    const usableZones = part.reassignment.filter((z) => z.judgment !== "Fail");
    if (usableZones.length === 0) {
      return { ...base, has_defect: true, note: "모든 구역에서 사용 불가 — 폐기 검토 대상" };
    }

    const best = usableZones.reduce((a, b) => (a.von_mises_mpa < b.von_mises_mpa ? a : b));
    const defectPanels = part.defect
      .map((d) => part.reassignment.find((z) => z.panel_id === d.panel_id))
      .filter((z): z is Panel => Boolean(z));
    const worstDefectPanel =
      defectPanels.length > 0
        ? defectPanels.reduce((a, b) => (a.von_mises_mpa > b.von_mises_mpa ? a : b))
        : undefined;

    const distance = worstDefectPanel ? euclideanDistanceMm(best, worstDefectPanel) : undefined;
    const reduction =
      worstDefectPanel && worstDefectPanel.von_mises_mpa > 0
        ? ((worstDefectPanel.von_mises_mpa - best.von_mises_mpa) / worstDefectPanel.von_mises_mpa) * 100
        : undefined;

    return {
      ...base,
      has_defect: true,
      recommended_panel_id: best.panel_id,
      recommended_stress_mpa: Math.round(best.von_mises_mpa * 10) / 10,
      own_defect_panel_id: worstDefectPanel?.panel_id,
      own_defect_stress_mpa:
        worstDefectPanel !== undefined ? Math.round(worstDefectPanel.von_mises_mpa * 10) / 10 : undefined,
      distance_from_defect_mm: distance !== undefined ? Math.round(distance * 10) / 10 : undefined,
      stress_reduction_pct: reduction !== undefined ? Math.round(reduction * 10) / 10 : undefined,
    };
  });
}

async function listBatchesOverview() {
  const { data, error } = await supabase
    .from("inspection_batches")
    .select("id, created_at, parts")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const parts = row.parts as BatchPart[];
    let pass = 0, conditional = 0, fail = 0;
    for (const part of parts) {
      const judgment = deriveJudgment(part.summary.usable_zone_count, part.summary.total_zone_count);
      if (judgment === "Pass") pass++;
      else if (judgment === "Conditional Pass") conditional++;
      else fail++;
    }
    return {
      id: row.id,
      created_at: row.created_at,
      part_count: parts.length,
      pass_count: pass,
      conditional_pass_count: conditional,
      fail_count: fail,
    };
  });
}

async function getBatchRecommendations(batchId: number) {
  const { data, error } = await supabase
    .from("inspection_batches")
    .select("parts")
    .eq("id", batchId)
    .single();
  if (error || !data) throw new Error(error?.message ?? `회차를 찾을 수 없음: ${batchId}`);
  const parts = data.parts as BatchPart[];
  const recommendations = computeBatchPositionRecommendations(parts);
  // 모델이 parts 배열을 직접 세다가 실수하는 걸 막기 위해, 이미 계산된 개수를
  // 미리 집계해서 함께 내려준다 — 답변에선 이 숫자를 그대로 쓰고 직접 세지 않게 한다.
  let pass = 0, conditional = 0, fail = 0;
  for (const r of recommendations) {
    if (r.judgment === "Pass") pass++;
    else if (r.judgment === "Conditional Pass") conditional++;
    else fail++;
  }
  return {
    batch_id: batchId,
    part_count: parts.length,
    pass_count: pass,
    conditional_pass_count: conditional,
    fail_count: fail,
    parts: recommendations,
  };
}

type ToolCallRecord = { name: string; input: unknown; result: unknown };

async function verifyGlobalReply(
  toolCallLog: ToolCallRecord[], replyText: string, userMessage: string
): Promise<{ verified: boolean; issues: string[] }> {
  // 도구를 전혀 안 썼는데 구체적 숫자가 없는 일반 설명 답변이면 과도한 오탐을 피하기
  // 위해 그냥 통과시킨다. 숫자가 있으면 반드시 도구 기록과 대조해 검증한다.
  if (toolCallLog.length === 0 && !/\d/.test(replyText)) {
    return { verified: true, issues: [] };
  }

  const prompt = `당신은 QA 검토자입니다. 아래는 사용자 질문, AI 어시스턴트가 실제로
호출한 도구와 그 결과, 그리고 그걸 바탕으로 작성한 답변입니다. 두 가지를 검토하세요:

1) 정확성: 답변에 언급된 수치(회차 ID, 부품 번호, 응력값, 구역 이름, 개수, 비율 등)가
   아래 도구 결과와 정확히 일치하는지. 도구 결과에 없는 내용을 지어냈으면 지적하세요.
   단순 반올림 표기 차이는 문제로 보지 마세요. 도구를 한 번도 안 썼는데 구체적 수치를
   답했다면 반드시 INCONSISTENT로 판정하세요.
2) 범위 누락: 질문이 여러 회차("최근 N개", "전체", "모든 회차" 등)를 가리키는데,
   도구 호출 기록에 그중 일부 회차만 조회되고 답변도 그 일부만 다뤘다면, 설령 그
   안에서는 숫자가 정확하더라도 범위를 빠뜨린 것이므로 INCONSISTENT로 판정하고
   어떤 회차가 빠졌는지 지적하세요.

[사용자 질문]
${userMessage}

[도구 호출 기록]
${JSON.stringify(toolCallLog, null, 2)}

[검토할 답변]
${replyText}

첫 줄에 두 기준 모두 문제없으면 CONSISTENT, 하나라도 문제가 있으면 INCONSISTENT라고만
쓰세요. INCONSISTENT면 그 다음 줄부터 문제점을 한 줄에 하나씩 "- "로 시작해서
나열하세요.`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5", max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock?.type === "text" ? textBlock.text : "";
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
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

export async function globalChatReply(
  history: ChatTurn[], userMessage: string
): Promise<{ reply: string; verified: boolean; issues: string[] }> {
  const systemPrompt = `당신은 발사체 부품 품질검사 시스템 전체 데이터를 조회할 수 있는
AI 어시스턴트입니다. 사용자는 레벨3 검사원이고, 부품 하나가 아니라 특정 회차 전체 또는
여러 회차에 걸친 질문을 할 수 있습니다. 반드시 도구를 사용해 실제 데이터를 확인한 뒤
답하세요. 도구로 확인하지 않은 수치(회차 ID, 부품 번호, 응력값, 구역 이름 등)는 절대
지어내지 마세요. 필요한 정보가 없으면 모른다고 답하세요. 한국어로 간결하게 답하세요.

회차를 특정하지 않았거나 "최근 N개", "전체 회차", "모든 회차"처럼 여러 회차를
가리키는 질문이면: 먼저 list_batches로 전체 회차 목록을 확인하세요. 그 다음, 질문이
가리키는 회차 각각에 대해 get_batch_recommendations를 빠짐없이 전부 호출하세요
(예: "최근 3개 회차"면 list_batches 결과에서 최신 3개 id를 골라 3번 다 호출 —
가장 최근 1개만 보고 답하면 안 됩니다). 한 번의 응답에서 도구를 여러 번(여러 회차)
동시에 호출할 수 있습니다. 질문 범위에 해당하는 회차 중 일부만 확인하고 답하는 것은
"지어내지 않기" 원칙 위반입니다 — 답변 서두에 어떤 회차들을 확인했는지 명시하세요.

Pass/Conditional Pass/Fail 개수를 말할 때는 반드시 도구 결과에 이미 들어있는
pass_count/conditional_pass_count/fail_count 값을 그대로 사용하세요 — 목록을 보고
직접 세면 실수할 수 있으니 직접 세지 마세요. 최솟값·최댓값·범위처럼 직접 계산이
필요한 요약은 암산으로 틀리기 쉬우니 만들지 말고, 필요하면 부품별 수치를 표나
목록으로 그대로 나열하세요.`;

  const messages: AnthropicTypes.MessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: userMessage },
  ];

  const toolCallLog: ToolCallRecord[] = [];
  const MAX_TOOL_ROUNDS = 4;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1536,
      system: systemPrompt,
      tools: [LIST_BATCHES_TOOL, GET_BATCH_RECOMMENDATIONS_TOOL],
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      const replyText = textBlock?.type === "text" ? textBlock.text : "";
      const { verified, issues } = await verifyGlobalReply(toolCallLog, replyText, userMessage);
      return { reply: replyText, verified, issues };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: AnthropicTypes.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "list_batches") {
        try {
          const result = await listBatchesOverview();
          toolCallLog.push({ name: block.name, input: block.input, result });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({
            type: "tool_result", tool_use_id: block.id, is_error: true,
            content: err instanceof Error ? err.message : "회차 목록 조회 실패",
          });
        }
      } else if (block.type === "tool_use" && block.name === "get_batch_recommendations") {
        const input = block.input as { batch_id: number };
        try {
          const result = await getBatchRecommendations(input.batch_id);
          toolCallLog.push({ name: block.name, input, result });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          toolResults.push({
            type: "tool_result", tool_use_id: block.id, is_error: true,
            content: err instanceof Error ? err.message : "회차 조회 실패",
          });
        }
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  const finalResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5", max_tokens: 1536, system: systemPrompt, messages,
  });
  const textBlock = finalResponse.content.find((b) => b.type === "text");
  const replyText = textBlock?.type === "text" ? textBlock.text : "";
  const { verified, issues } = await verifyGlobalReply(toolCallLog, replyText, userMessage);
  return { reply: replyText, verified, issues };
}
