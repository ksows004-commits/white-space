export type Judgment = "Pass" | "Conditional Pass" | "Fail";

export interface Panel {
  panel_id: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  von_mises_mpa: number;
  judgment: Judgment;
}

export interface Defect {
  panel_id: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  sqrt_area_um: number;
  location: "surface" | "internal";
  judgment: Judgment;
}

export interface Summary {
  worst_judgment: Judgment;
  affected_panel_id: string | null;
  usable_zone_count?: number;
  total_zone_count?: number;
}

export interface JudgeResult {
  panels: Panel[];
  reassignment: Panel[];
  // 부품 하나에 결함이 여러 개일 수 있어 배열. 결함 없음 = 빈 배열.
  defect: Defect[];
  summary: Summary;
}

export interface BatchPart extends JudgeResult {
  serial_number: string;
  report?: string;
  report_verified?: boolean;
  report_issues?: string[];
  work_order?: string;
}

// 조립 전 검사라 "결함이 실제로 있는 자리"라는 개념이 의미가 없다 — 부품은
// 회전/축방향 재설치가 가능해서, 결함이 116개 구역 중 몇 곳에서 버티는지로
// 부품 전체 판정을 다시 정의한다 (summary.worst_judgment는 더 이상 신뢰하지
// 않고 항상 이 함수로 계산한다. usable_zone_count/total_zone_count는 이미
// 계산·저장돼 있어 기존 회차도 재계산 없이 그대로 적용 가능).
export function deriveJudgment(usable?: number, total?: number): Judgment {
  if (usable === undefined || total === undefined || total <= 0) return "Fail";
  if (usable === total) return "Pass";
  if (usable === 0) return "Fail";
  return "Conditional Pass";
}
