import { NextRequest, NextResponse } from "next/server";
import { generateReport } from "@/lib/report";
import type { JudgeResult } from "@/lib/types";

const GPU_API_URL = process.env.GPU_API_URL ?? "http://localhost:8000";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let judgment: JudgeResult;
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
