"use client";

import Link from "next/link";
import { PanelGridMap } from "@/components/PanelGridMap";
import { use, useEffect, useState } from "react";
import { deriveJudgment } from "@/lib/types";
import type { JudgeResult } from "@/lib/types";

interface ScenarioResult extends JudgeResult {
  scenario_id: string;
  report: string;
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


  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/scenarios" className="text-sm text-gray-600 underline">
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
          {data.defect.length > 0 && (
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

          <PanelGridMap panels={shownPanels ?? []}
            highlightPanelIds={mode === "panels" ? data.defect.map((d) => d.panel_id) : []}
            className="mt-4" />
          {data.defect.length > 0 && (
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
              종합 판정: {deriveJudgment(data.summary.usable_zone_count, data.summary.total_zone_count)}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              조립 전 검사 기준 — 회전/축방향 재설치가 가능한 116개 구역 중 몇 곳에서 버틸 수
              있는지로 판정합니다.
            </p>
            {data.defect.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {data.defect.map((d, i) => (
                  <li key={i}>
                    결함 {i + 1}: {d.panel_id} (√area {d.sqrt_area_um}μm,{" "}
                    {d.location === "surface" ? "표면" : "내부"})
                  </li>
                ))}
              </ul>
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
