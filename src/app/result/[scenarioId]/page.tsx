import Link from "next/link";

export default function ResultPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link href="/" className="text-sm text-gray-600 underline">시나리오 선택으로 돌아가기</Link>
      <h1 className="mt-4 text-2xl font-semibold">분석 결과</h1>
      <section aria-label="3D 뷰어 자리" className="mt-6 flex min-h-72 items-center justify-center rounded-lg border border-gray-300 bg-gray-100 p-6">
        <p className="text-gray-600">3D 뷰어 자리</p>
      </section>
      <section aria-labelledby="report-title" className="mt-6 rounded-lg border border-gray-300 bg-white p-6">
        <h2 id="report-title" className="text-lg font-semibold">AI 분석 리포트</h2>
        <p className="mt-3 text-gray-600">분석 리포트가 표시될 자리입니다. 현재는 화면 구조 확인을 위한 목업 텍스트입니다.</p>
      </section>
    </main>
  );
}
