"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatTurn } from "@/lib/chat";

interface BatchSummary {
  id: number;
  created_at: string;
  part_count: number;
}

export default function Home() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  async function sendGlobalChatMessage() {
    const message = chatInput.trim();
    if (!message || chatLoading) return;
    const history = chatHistory;
    setChatHistory((previous) => [...previous, { role: "user", content: message }]);
    setChatInput("");
    setChatError(null);
    setChatLoading(true);
    try {
      const res = await fetch("/api/global-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "상담 응답 생성 실패");
      setChatHistory((previous) => [
        ...previous,
        { role: "assistant", content: data.reply, verified: data.verified, issues: data.issues },
      ]);
    } catch (err) {
      setChatHistory(history);
      setChatInput(message);
      setChatError(err instanceof Error ? `오류: ${err.message}` : "오류");
    } finally {
      setChatLoading(false);
    }
  }

  function loadBatches() {
    fetch("/api/batches")
      .then((res) => res.json())
      .then((data) => setBatches(data.batches ?? []));
  }

  useEffect(() => {
    loadBatches();
  }, []);

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 다시 선택해도 onChange가 또 뜨도록
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/batches/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업로드 실패");
      router.push(`/batches/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/scenarios" className="text-sm text-gray-600 underline">
        시나리오 데모 보기 →
      </Link>
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">검사 회차 목록</h1>
        <div className="flex gap-2">
          <label className="cursor-pointer rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">
            검사 파일 업로드
            <input
              type="file"
              accept=".csv"
              onChange={uploadFile}
              disabled={loading}
              className="hidden"
            />
          </label>
        </div>
      </div>
      {loading && <p className="mt-2 text-sm text-gray-500">처리 중... (몇 초 걸릴 수 있음)</p>}

      {error && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-red-700">{error}</p>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-300">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2">회차 ID</th>
              <th className="px-4 py-2">검사 일시</th>
              <th className="px-4 py-2">부품 수</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr
                key={b.id}
                className="cursor-pointer border-t border-gray-200 hover:bg-gray-50"
                onClick={() => router.push(`/batches/${b.id}`)}
              >
                <td className="px-4 py-2">#{b.id}</td>
                <td className="px-4 py-2">{new Date(b.created_at).toLocaleString("ko-KR")}</td>
                <td className="px-4 py-2">{b.part_count}개</td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                  아직 실행한 회차가 없습니다. 위 버튼으로 시작하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-8 rounded-lg border border-gray-300 bg-white p-6">
        <h2 className="font-medium">전체 회차 AI 상담</h2>
        <p className="mt-1 text-xs text-gray-500">
          부품 하나가 아니라 특정 회차 전체 또는 여러 회차에 걸친 질문을 할 수 있습니다.
          예: &quot;45번 회차 부품들 각각 어디에 설치하면 되나요?&quot;, &quot;지금까지 회차 중
          Conditional Pass가 가장 많았던 건 어디인가요?&quot;
        </p>
        <div className="mt-3 space-y-3" aria-live="polite">
          {chatHistory.map((turn, index) => (
            <div key={index} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className="max-w-[85%]">
                <p
                  className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    turn.role === "user" ? "bg-blue-50 text-blue-800" : "text-gray-700"
                  }`}
                >
                  {turn.content}
                </p>
                {turn.role === "assistant" && turn.verified === false && (
                  <span
                    className="mt-1 inline-block rounded bg-amber-50 px-2 py-1 text-xs text-amber-700"
                    title={turn.issues?.join("\n")}
                  >
                    ⚠ 확인 필요
                  </span>
                )}
              </div>
            </div>
          ))}
          {chatLoading && <p className="text-sm text-gray-500">답변 생성 중...</p>}
          {chatError && <p className="text-sm text-red-700">{chatError}</p>}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendGlobalChatMessage();
          }}
        >
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
            }}
            disabled={chatLoading}
            aria-label="전체 회차에 대한 질문"
            placeholder="예: 45번 회차 부품들 각각 어디에 설치하면 되나요?"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={chatLoading || !chatInput.trim()}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            전송
          </button>
        </form>
      </section>
    </main>
  );
}
