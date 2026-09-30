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
