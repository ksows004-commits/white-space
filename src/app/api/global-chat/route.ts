import { NextResponse } from "next/server";
import { globalChatReply, type ChatTurn } from "@/lib/globalChat";

// 특정 부품/회차에 묶이지 않은 전역 AI 상담 — "전체 회차" 질문을 받는다.
export async function POST(request: Request) {
  let body: { message: string; history: ChatTurn[] };
  try {
    body = await request.json();
    if (
      !body ||
      typeof body.message !== "string" || !body.message.trim() ||
      !Array.isArray(body.history) ||
      body.history.some(
        (turn) => !turn || !["user", "assistant"].includes(turn.role) || typeof turn.content !== "string"
      )
    ) {
      return NextResponse.json({ error: "message, history 형식을 확인하세요" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "올바른 JSON 요청이 필요합니다" }, { status: 400 });
  }

  try {
    const { reply, verified, issues } = await globalChatReply(body.history, body.message);
    return NextResponse.json({ reply, verified, issues });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "상담 응답 생성 실패" }, { status: 500 }
    );
  }
}
