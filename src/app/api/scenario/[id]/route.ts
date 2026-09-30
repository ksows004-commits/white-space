import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const GPU_API_URL = process.env.GPU_API_URL ?? "http://localhost:8000";

type Judgment = "Pass" | "Conditional Pass" | "Fail";

interface Panel {
  panel_id: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  von_mises_mpa: number;
  judgment: Judgment;
}

interface Defect {
  panel_id: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  sqrt_area_um: number;
  location: "surface" | "internal";
}

interface JudgeResponse {
  scenario_id: string;
  data_source: string;
  panels: Panel[];
  defect: Defect | null;
  summary: {
    worst_judgment: Judgment;
    affected_panel_id: string;
  };
}

const anthropic = new Anthropic();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let judgment: JudgeResponse;
  try {
    const judgeResponse = await fetch(`${GPU_API_URL}/judge/${id}`);
    if (!judgeResponse.ok) {
      return NextResponse.json(
        { error: `GPU 서버 판정 API 호출 실패 (${judgeResponse.status})` },
        { status: 502 }
      );
    }
    judgment = await judgeResponse.json();
  } catch {
    return NextResponse.json(
      { error: "GPU 서버에 연결할 수 없습니다. SSH 터널이 열려 있는지 확인하세요." },
      { status: 502 }
    );
  }

  const report = await generateReport(judgment);

  return NextResponse.json({ ...judgment, report });
}

async function generateReport(judgment: JudgeResponse): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(judgment) }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}

function buildPrompt(judgment: JudgeResponse): string {
  const { summary, defect, panels } = judgment;
  const affectedPanel = panels.find((p) => p.panel_id === summary.affected_panel_id);

  const defectDescription = defect
    ? `위치(x=${defect.x_mm}mm, y=${defect.y_mm}mm, z=${defect.z_mm}mm), 결함 크기(√area) ${defect.sqrt_area_um}μm, 위치 종류: ${defect.location === "surface" ? "표면" : "내부"}`
    : "결함 없음";

  return `당신은 발사체 부품 품질을 검토하는 레벨3 비파괴검사(NDT) 전문가입니다.
아래 계산된 데이터만 근거로 삼아, 다른 숫자를 지어내지 말고 분석 리포트를 작성하세요.

[결함 정보]
${defectDescription}

[최종 판정]
${summary.worst_judgment} (영향받은 구역: ${summary.affected_panel_id})

[해당 구역 응력]
${affectedPanel ? `${affectedPanel.von_mises_mpa} MPa` : "정보 없음"}

다음 내용을 포함해 한국어로 200자 내외 리포트를 작성하세요:
1. 판정 결과 요약
2. 판정 근거 (응력값과 결함 정보를 바탕으로)
3. 조건부 승인(Conditional Pass)인 경우, 이 부품을 재배치해서 쓸 수 있는 이유
4. Fail인 경우, 왜 이 위치에는 쓸 수 없는지

위에 주어진 수치만 사용하고, 주어지지 않은 정보는 지어내지 마세요.`;
}
