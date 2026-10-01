"use client";

import { Fragment, useMemo } from "react";
import type { Panel, Judgment } from "@/lib/types";

const JUDGMENT_COLOR: Record<Judgment, string> = {
  Pass: "#22c55e",
  "Conditional Pass": "#f59e0b",
  Fail: "#ef4444",
};

// panel_id는 "xBucket_yBucket_zBucket" 형식(judge.py의 assign_grid_cell이 만듦).
// x,z는 원통 단면(둘레 방향), y는 축방향(길이) — 이전 지도가 x,y로 각도를 계산하고
// z로 세로축을 그려서 물리적으로 틀렸던 버그를 여기서 고친다.
function parsePanelId(panelId: string): [number, number, number] | null {
  const parts = panelId.split("_").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

function angleDeg(x: number, z: number): number {
  return ((Math.atan2(z, x) * 180) / Math.PI + 360) % 360;
}

function buildGrid(panels: Panel[]) {
  type ColAgg = { xBucket: number; zBucket: number; sumX: number; sumZ: number; count: number };
  const colAgg = new Map<string, ColAgg>();
  type RowAgg = { yBucket: number; sumY: number; count: number };
  const rowAgg = new Map<number, RowAgg>();
  const cellByRowCol = new Map<string, Panel>();

  for (const panel of panels) {
    const parsed = parsePanelId(panel.panel_id);
    if (!parsed) continue;
    const [xBucket, yBucket, zBucket] = parsed;

    const colKey = `${xBucket}_${zBucket}`;
    const col = colAgg.get(colKey) ?? { xBucket, zBucket, sumX: 0, sumZ: 0, count: 0 };
    col.sumX += panel.x_mm;
    col.sumZ += panel.z_mm;
    col.count += 1;
    colAgg.set(colKey, col);

    const row = rowAgg.get(yBucket) ?? { yBucket, sumY: 0, count: 0 };
    row.sumY += panel.y_mm;
    row.count += 1;
    rowAgg.set(yBucket, row);

    cellByRowCol.set(`${yBucket}|${colKey}`, panel);
  }

  const columns = Array.from(colAgg.entries())
    .map(([key, v]) => ({ key, angle: angleDeg(v.sumX / v.count, v.sumZ / v.count) }))
    .sort((a, b) => a.angle - b.angle);

  const rows = Array.from(rowAgg.entries())
    .map(([yBucket, v]) => ({ key: String(yBucket), yBucket, axialMm: Math.round(v.sumY / v.count) }))
    .sort((a, b) => a.yBucket - b.yBucket);

  return { columns, rows, cellByRowCol };
}

export function PanelGridMap({
  panels,
  highlightPanelIds = [],
  className = "",
}: {
  panels: Panel[];
  highlightPanelIds?: string[];
  className?: string;
}) {
  const { columns, rows, cellByRowCol } = useMemo(() => buildGrid(panels), [panels]);
  const highlightSet = useMemo(() => new Set(highlightPanelIds), [highlightPanelIds]);

  if (columns.length === 0 || rows.length === 0) {
    return <p className="text-sm text-gray-500">표시할 구역 데이터가 없습니다.</p>;
  }

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-[3px]"
          style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(26px, 1fr))` }}
        >
          <div />
          {columns.map((col) => (
            <div key={col.key} className="text-center text-[10px] leading-tight text-gray-500">
              {Math.round(col.angle)}°
            </div>
          ))}

          {rows.map((row) => (
            <Fragment key={row.key}>
              <div className="flex items-center justify-end pr-1 text-[10px] text-gray-500">
                {row.axialMm}mm
              </div>
              {columns.map((col) => {
                const panel = cellByRowCol.get(`${row.key}|${col.key}`);
                if (!panel) return <div key={col.key} className="aspect-square" />;
                const highlighted = highlightSet.has(panel.panel_id);
                return (
                  <div
                    key={col.key}
                    title={`${panel.panel_id} · ${panel.von_mises_mpa.toFixed(2)} MPa · ${panel.judgment}`}
                    className="aspect-square rounded-sm"
                    style={{
                      backgroundColor: JUDGMENT_COLOR[panel.judgment],
                      outline: highlighted ? "2px solid #111827" : undefined,
                      outlineOffset: highlighted ? "-2px" : undefined,
                    }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-600">
        {(Object.keys(JUDGMENT_COLOR) as Judgment[]).map((j) => (
          <span key={j} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: JUDGMENT_COLOR[j] }} />
            {j}
          </span>
        ))}
        {highlightPanelIds.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-gray-900" />
            강조 표시된 구역
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-gray-400">
        가로: 둘레 방향(0°~360°, 부품을 펼친 각도) · 세로: 축방향 위치(부품 길이 방향, mm)
      </p>
    </div>
  );
}
