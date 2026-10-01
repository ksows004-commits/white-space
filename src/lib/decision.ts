import { supabase } from "./supabase";
import type { BatchPart } from "./types";

export type InspectorDecision = "approved" | "rejected";

export async function recordInspectorDecision(
  batchId: string, serial: string, decision: InspectorDecision, note?: string
): Promise<BatchPart> {
  if (decision !== "approved" && decision !== "rejected") throw new Error("올바른 승인/반려 값이 필요합니다");
  if (note !== undefined && typeof note !== "string") throw new Error("메모는 문자열이어야 합니다");
  const { data, error } = await supabase.from("inspection_batches")
    .select("parts").eq("id", batchId).single();
  if (error || !data) throw new Error(error?.message ?? "찾을 수 없음");
  const parts = data.parts as BatchPart[];
  const index = parts.findIndex((part) => part.serial_number === serial);
  if (index === -1) throw new Error(`부품을 찾을 수 없음: ${serial}`);
  parts[index] = { ...parts[index], inspector_decision: decision,
    inspector_note: note, inspector_decided_at: new Date().toISOString() };
  const { error: updateError } = await supabase.from("inspection_batches")
    .update({ parts }).eq("id", batchId);
  if (updateError) throw new Error(updateError.message);
  return parts[index];
}
