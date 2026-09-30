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
  defect: Defect | null;
  summary: Summary;
}

export interface BatchPart extends JudgeResult {
  serial_number: string;
  report?: string;
}
