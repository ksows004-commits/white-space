"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface BatchSummary {
  id: number;
  created_at: string;
  part_count: number;
}

export default function BatchesPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadBatches() {
    fetch("/api/batches")
      .then((res) => res.json())
      .then((data) => setBatches(data.batches ?? []));
  }

  useEffect(() => {
    loadBatches();
  }, []);

  async function runNewBatch() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 10 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "실행 실패");
      router.push(`/batches/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

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
      <Link href="/" className="text-sm text-gray-600 underline">
        시나리오 선택으로 돌아가기
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
          <button
            onClick={runNewBatch}
            disabled={loading}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? "처리 중... (몇 초 걸릴 수 있음)" : "새 회차 실행 (10개, 테스트용)"}
          </button>
        </div>
      </div>

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
    </main>
  );
}
