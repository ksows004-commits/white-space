"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { BatchPart, Judgment } from "@/lib/types";

const JUDGMENT_COLOR: Record<Judgment, string> = {
  Pass: "text-green-700 bg-green-50",
  "Conditional Pass": "text-amber-700 bg-amber-50",
  Fail: "text-red-700 bg-red-50",
};

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [parts, setParts] = useState<BatchPart[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [synthesisLoading, setSynthesisLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/batches/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "불러오기 실패");
        setParts(data.parts);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function openDetail(serial: string) {
    setSelected(serial);
    setReport(null);
    setReportLoading(true);
    try {
      const res = await fetch(`/api/batches/${id}/report?serial=${encodeURIComponent(serial)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "리포트 생성 실패");
      setReport(data.report);
    } catch (err) {
      setReport(err instanceof Error ? `오류: ${err.message}` : "오류");
    } finally {
      setReportLoading(false);
    }
  }

  async function openSynthesis() {
    setSynthesis(null);
    setSynthesisLoading(true);
    try {
      const res = await fetch(`/api/batches/${id}/synthesis`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "종합 분석 생성 실패");
      setSynthesis(data.synthesis);
    } catch (err) {
      setSynthesis(err instanceof Error ? `오류: ${err.message}` : "오류");
    } finally {
      setSynthesisLoading(false);
    }
  }

  const selectedPart = parts?.find((p) => p.serial_number === selected) ?? null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/batches" className="text-sm text-gray-600 underline">
        회차 목록으로 돌아가기
      </Link>
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">회차 #{id} 검사 결과</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openSynthesis}
            disabled={!parts || synthesisLoading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            회차 종합 분석 보기
          </button>
          <a
            href={`/api/batches/${id}/csv`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            CSV 다운로드
          </a>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-red-700">{error}</p>
      )}
      {!parts && !error && <p className="mt-6 text-gray-600">불러오는 중...</p>}

      {(synthesisLoading || synthesis !== null) && (
        <section className="mt-6 rounded-lg border border-gray-300 bg-white p-6" aria-live="polite">
          <h2 className="text-lg font-semibold">회차 종합 분석</h2>
          {synthesisLoading && <p className="mt-2 text-gray-500">종합 분석 생성 중...</p>}
          {!synthesisLoading && synthesis !== null && (
            <p className="mt-2 whitespace-pre-wrap text-gray-700">{synthesis}</p>
          )}
        </section>
      )}

      {parts && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-300">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2">부품번호</th>
                <th className="px-4 py-2">판정</th>
                <th className="px-4 py-2">결함</th>
                <th className="px-4 py-2">재배치 가능 구역</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr
                  key={p.serial_number}
                  className="cursor-pointer border-t border-gray-200 hover:bg-gray-50"
                  onClick={() => openDetail(p.serial_number)}
                >
                  <td className="px-4 py-2 font-mono">{p.serial_number}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 ${JUDGMENT_COLOR[p.summary.worst_judgment]}`}>
                      {p.summary.worst_judgment}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {p.defect.length === 0
                      ? "-"
                      : p.defect.length === 1
                        ? `√area ${p.defect[0].sqrt_area_um}μm · ${p.defect[0].location === "surface" ? "표면" : "내부"}`
                        : `결함 ${p.defect.length}개`}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {p.summary.usable_zone_count ?? "-"} / {p.summary.total_zone_count ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedPart && (
        <section className="mt-6 rounded-lg border border-gray-300 bg-white p-6">
          <h2 className="text-lg font-semibold">{selectedPart.serial_number} 상세</h2>
          <p className="mt-2 text-sm text-gray-600">
            판정: <strong>{selectedPart.summary.worst_judgment}</strong> · 영향 구역:{" "}
            {selectedPart.summary.affected_panel_id ?? "없음"} · 재배치 가능 구역:{" "}
            {selectedPart.summary.usable_zone_count}/{selectedPart.summary.total_zone_count}
          </p>
          {selectedPart.defect.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-gray-600">
              {selectedPart.defect.map((d, i) => (
                <li key={i}>
                  결함 {i + 1}: {d.panel_id} · √area {d.sqrt_area_um}μm ·{" "}
                  {d.location === "surface" ? "표면" : "내부"} ·{" "}
                  <span className={`rounded px-1.5 py-0.5 text-xs ${JUDGMENT_COLOR[d.judgment]}`}>
                    {d.judgment}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <h3 className="font-medium">AI 분석 리포트</h3>
            {reportLoading && <p className="mt-2 text-gray-500">리포트 생성 중...</p>}
            {!reportLoading && report && (
              <p className="mt-2 whitespace-pre-wrap text-gray-700">{report}</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
