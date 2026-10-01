import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { chatReply, type ChatTurn } from "@/lib/chat";
import type { BatchPart } from "@/lib/types";

export async function POST(
  request: Request, { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { serial: string; message: string; history: ChatTurn[] };
  try {
    body = await request.json();
    if (!body || typeof body.serial !== "string" || !body.serial.trim()
      || typeof body.message !== "string" || !body.message.trim()
      || !Array.isArray(body.history)
      || body.history.some((turn) => !turn || !["user", "assistant"].includes(turn.role)
        || typeof turn.content !== "string")) {
      return NextResponse.json({ error: "serial, message, history 형식을 확인하세요" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "올바른 JSON 요청이 필요합니다" }, { status: 400 });
  }
  const { data, error } = await supabase.from("inspection_batches")
    .select("parts").eq("id", id).single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "찾을 수 없음" }, { status: 404 });
  }
  const part = (data.parts as BatchPart[]).find((part) => part.serial_number === body.serial);
  if (!part) {
    return NextResponse.json({ error: `부품을 찾을 수 없음: ${body.serial}` }, { status: 404 });
  }
  try {
    const { reply, verified, issues, usedReassignmentTool } = await chatReply(part, id, body.serial, body.history, body.message);
    // Decision tools may have updated parts during the conversation. Reload
    // before appending history so this save preserves the inspector decision.
    const { data: latest, error: reloadError } = await supabase.from("inspection_batches")
      .select("parts").eq("id", id).single();
    if (reloadError || !latest) throw new Error(reloadError?.message ?? "찾을 수 없음");
    const parts = latest.parts as BatchPart[];
    const index = parts.findIndex((part) => part.serial_number === body.serial);
    if (index === -1) throw new Error(`부품을 찾을 수 없음: ${body.serial}`);
    const showMap = usedReassignmentTool;
    parts[index] = { ...parts[index], chat_history: [
      ...(parts[index].chat_history ?? []),
      { role: "user", content: body.message },
      { role: "assistant", content: reply, verified, issues, showMap },
    ] };
    const { error: updateError } = await supabase.from("inspection_batches")
      .update({ parts }).eq("id", id);
    if (updateError) throw new Error(updateError.message);
    return NextResponse.json({ reply, verified, issues, showMap, usedReassignmentTool, part: parts[index] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "상담 응답 생성 실패" }, { status: 500 });
  }
}
