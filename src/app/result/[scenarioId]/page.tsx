"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { Judgment, JudgeResult } from "@/lib/types";

interface ScenarioResult extends JudgeResult {
  scenario_id: string;
  report: string;
}

const JUDGMENT_COLOR: Record<Judgment, string> = {
  Pass: "#22c55e",
  "Conditional Pass": "#f59e0b",
  Fail: "#ef4444",
};

function angleDeg(x: number, y: number): number {
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

type MapMode = "panels" | "reassignment";

export default function ResultPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = use(params);
  const [data, setData] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MapMode>("panels");

  useEffect(() => {
    setData(null);
    setError(null);
    setMode("panels");
    fetch(`/api/scenario/${scenarioId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `요청 실패 (${res.status})`);
        }
        return res.json();
      })
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [scenarioId]);

  const shownPanels = mode === "panels" ? data?.panels : data?.reassignment;
  const zValues = shownPanels?.map((p) => p.z_mm) ?? [];
  const zMin = Math.min(...zValues);
  const zMax = Math.max(...zValues);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/" className="text-sm text-gray-600 underline">
        시나리오 선택으로 돌아가기
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">분석 결과 — {scenarioId.toUpperCase()}</h1>

      {error && (
        <p className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}

      {!data && !error && (
        <p className="mt-6 text-gray-600">GPU 서버에서 판정 계산 중... (몇 초 걸릴 수 있습니다)</p>
      )}

      {data && (
        <>
          {data.defect && (
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setMode("panels")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  mode === "panels" ? "bg-gray-900 text-white" : "border border-gray-300"
                }`}
              >
                실제 결함 위치
              </button>
              <button
                onClick={() => setMode("reassignment")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  mode === "reassignment" ? "bg-gray-900 text-white" : "border border-gray-300"
                }`}
              >
                재배치 가능 구역
              </button>
            </div>
          )}

          <section
            aria-label="동체외벽 2D 전개도"
            className="relative mt-4 h-72 overflow-hidden rounded-lg border border-gray-300 bg-gray-100"
          >
            {shownPanels?.map((panel) => {
              const left = (angleDeg(panel.x_mm, panel.y_mm) / 360) * 100;
              const top = zMax === zMin ? 50 : ((panel.z_mm - zMin) / (zMax - zMin)) * 100;
              const isDefect = panel.panel_id === data.defect?.panel_id;
              return (
                <div
                  key={panel.panel_id}
                  title={`${panel.panel_id} · ${panel.von_mises_mpa} MPa · ${panel.judgment}`}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm"
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    backgroundColor: JUDGMENT_COLOR[panel.judgment],
                    outline: mode === "panels" && isDefect ? "2px solid black" : undefined,
                  }}
                />
              );
            })}
            <div className="absolute bottom-2 left-2 flex gap-3 rounded bg-white/80 px-2 py-1 text-xs">
              {(Object.keys(JUDGMENT_COLOR) as Judgment[]).map((j) => (
                <span key={j} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: JUDGMENT_COLOR[j] }}
                  />
                  {j}
                </span>
              ))}
            </div>
          </section>
          {data.defect && (
            <p className="mt-2 text-xs text-gray-500">
              {mode === "panels"
                ? "이 부품이 실제로 제작됐을 때의 지도 — 검은 테두리가 결함 위치입니다."
                : "이 결함을 부품 위 다른 모든 구역으로 옮겼다고 가정했을 때의 지도 — 초록/주황 구역은 재배치해서 쓸 수 있습니다."}
            </p>
          )}

          <section
            aria-labelledby="summary-title"
            className="mt-6 rounded-lg border border-gray-300 bg-white p-6"
          >
            <h2 id="summary-title" className="text-lg font-semibold">
              최종 판정: {data.summary.worst_judgment}
            </h2>
            {data.defect && (
              <p className="mt-2 text-sm text-gray-600">
                결함 위치: {data.defect.panel_id} (√area {data.defect.sqrt_area_um}μm,{" "}
                {data.defect.location === "surface" ? "표면" : "내부"})
              </p>
            )}
            {data.summary.usable_zone_count !== undefined && (
              <p className="mt-1 text-sm text-gray-600">
                재배치 가능 구역: {data.summary.usable_zone_count} / {data.summary.total_zone_count}
              </p>
            )}
          </section>

          <section
            aria-labelledby="report-title"
            className="mt-6 rounded-lg border border-gray-300 bg-white p-6"
          >
            <h2 id="report-title" className="text-lg font-semibold">
              AI 분석 리포트
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-gray-700">{data.report}</p>
          </section>
        </>
      )}
    </main>
  );
}
