"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import type { BatchPart, Judgment } from "@/lib/types";
import type { ChatTurn } from "@/lib/chat";

const JUDGMENT_COLOR: Record<Judgment, string> = {
  Pass: "text-green-700 bg-green-50",
  "Conditional Pass": "text-amber-700 bg-amber-50",
  Fail: "text-red-700 bg-red-50",
};

type TriagePriorityItem = {
  serial_number: string;
  worst_judgment: Judgment;
  usable_zone_count: number | null;
  total_zone_count: number | null;
  priority_reason: string;
};

type TriageResult = {
  reports_generated: number;
  synthesis: string;
  priority_list: TriagePriorityItem[];
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
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [reportVerified, setReportVerified] = useState<boolean | undefined>(undefined);
  const [reportIssues, setReportIssues] = useState<string[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const detailVersion = useRef(0);

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
    const version = ++detailVersion.current;
    setChatHistory([]);
    setChatInput("");
    setChatLoading(false);
    setChatError(null);
    setReportVerified(undefined);
    setReportIssues([]);
    setSelected(serial);
    setReport(null);
    setReportLoading(true);
    try {
      const res = await fetch(`/api/batches/${id}/report?serial=${encodeURIComponent(serial)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "리포트 생성 실패");
      if (version !== detailVersion.current) return;
      setReport(data.report);
      setReportVerified(data.verified);
      setReportIssues(data.issues ?? []);
    } catch (err) {
      if (version !== detailVersion.current) return;
      setReport(err instanceof Error ? `오류: ${err.message}` : "오류");
    } finally {
      if (version === detailVersion.current) setReportLoading(false);
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

  async function runTriage() {
    setTriageResult(null);
    setTriageError(null);
    setTriageLoading(true);
    try {
      const res = await fetch(`/api/batches/${id}/triage`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "트리아지 실행 실패");
      setTriageResult(data);
      const batchRes = await fetch(`/api/batches/${id}`);
      const batchData = await batchRes.json();
      if (!batchRes.ok) throw new Error(batchData.error ?? "작업지시서 불러오기 실패");
      setParts(batchData.parts);
    } catch (err) {
      setTriageError(err instanceof Error ? `오류: ${err.message}` : "오류");
    } finally {
      setTriageLoading(false);
    }
  }

  async function sendChatMessage() {
    const message = chatInput.trim();
    if (!selected || !message || chatLoading) return;
    const version = detailVersion.current;
    const history = chatHistory;
    setChatHistory((previous) => [...previous, { role: "user", content: message }]);
    setChatInput("");
    setChatError(null);
    setChatLoading(true);
    try {
      const res = await fetch(`/api/batches/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: selected, message, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "상담 응답 생성 실패");
      if (version !== detailVersion.current) return;
      setChatHistory((previous) => [...previous, { role: "assistant", content: data.reply }]);
    } catch (err) {
      if (version !== detailVersion.current) return;
      setChatHistory(history);
      setChatInput(message);
      setChatError(err instanceof Error ? `오류: ${err.message}` : "오류");
    } finally {
      if (version === detailVersion.current) setChatLoading(false);
    }
  }

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
            onClick={runTriage}
            disabled={!parts || triageLoading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            배치 트리아지 실행
          </button>
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

      {(triageLoading || triageError || triageResult) && (
        <section className="mt-6 rounded-lg border border-gray-300 bg-white p-6" aria-live="polite">
          <h2 className="text-lg font-semibold">배치 트리아지 결과</h2>
          {triageLoading && <p className="mt-2 text-gray-500">리포트 및 종합 분석 생성 중...</p>}
          {triageError && <p className="mt-2 text-red-700">{triageError}</p>}
          {triageResult && (
            <>
              <p className="mt-2 text-sm text-gray-600">리포트 {triageResult.reports_generated}개 생성됨</p>
              <p className="mt-2 whitespace-pre-wrap text-gray-700">{triageResult.synthesis}</p>
              <div className="mt-4 overflow-x-auto rounded-lg border border-gray-300">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2">부품번호</th>
                      <th className="px-4 py-2">판정</th>
                      <th className="px-4 py-2">재배치 가능 구역</th>
                      <th className="px-4 py-2">사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {triageResult.priority_list.map((item) => (
                      <tr
                        key={item.serial_number}
                        className="cursor-pointer border-t border-gray-200 hover:bg-gray-50"
                        onClick={() => openDetail(item.serial_number)}
                      >
                        <td className="px-4 py-2 font-mono">{item.serial_number}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded px-2 py-0.5 ${JUDGMENT_COLOR[item.worst_judgment]}`}>
                            {item.worst_judgment}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {item.usable_zone_count ?? "-"} / {item.total_zone_count ?? "-"}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{item.priority_reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

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
            {!reportLoading && reportVerified === true && (
              <span className="mt-2 inline-block rounded bg-green-50 px-2 py-1 text-xs text-green-700">✓ 검증 완료</span>
            )}
            {!reportLoading && reportVerified === false && (
              <div className="mt-2 text-sm text-amber-700">
                <span className="rounded bg-amber-50 px-2 py-1 text-xs">⚠ {reportIssues.length}개 문제 발견</span>
                {reportIssues.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs">
                    {reportIssues.map((issue, index) => <li key={index}>{issue}</li>)}
                  </ul>
                )}
              </div>
            )}
            {reportLoading && <p className="mt-2 text-gray-500">리포트 생성 중...</p>}
            {!reportLoading && report && (
              <p className="mt-2 whitespace-pre-wrap text-gray-700">{report}</p>
            )}
          </div>
          {selectedPart.work_order && (
            <div className="mt-6">
              <h3 className="font-medium">재배치 작업지시서</h3>
              <p className="mt-2 whitespace-pre-wrap text-gray-700">{selectedPart.work_order}</p>
            </div>
          )}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <h3 className="font-medium">AI 상담</h3>
            <div className="mt-3 space-y-3" aria-live="polite">
              {chatHistory.map((turn, index) => (
                <div key={index} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <p className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${turn.role === "user" ? "bg-blue-50 text-blue-800" : "text-gray-700"}`}>
                    {turn.content}
                  </p>
                </div>
              ))}
              {chatLoading && <p className="text-sm text-gray-500">답변 생성 중...</p>}
              {chatError && <p className="text-sm text-red-700">{chatError}</p>}
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void sendChatMessage(); }}>
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}
                disabled={chatLoading}
                aria-label="부품 판정에 대한 질문"
                placeholder="판정에 대해 질문하세요"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button type="submit" disabled={chatLoading || !chatInput.trim()}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                전송
              </button>
            </form>
          </div>
        </section>
      )}
    </main>
  );
}
