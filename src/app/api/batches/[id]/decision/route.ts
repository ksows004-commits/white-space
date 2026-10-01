import { NextResponse } from "next/server";
import { recordInspectorDecision } from "@/lib/decision";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "올바른 JSON 요청이 필요합니다" }, { status: 400 });
  }
  if (!body || typeof body.serial !== "string" || !body.serial.trim()
    || !["approved", "rejected"].includes(body.decision)
    || (body.note !== undefined && typeof body.note !== "string")) {
    return NextResponse.json({ error: "serial, decision, note 형식을 확인하세요" }, { status: 400 });
  }
  try {
    const part = await recordInspectorDecision(id, body.serial, body.decision, body.note);
    return NextResponse.json({ part });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "결정 저장 실패" }, { status: 500 });
  }
}
