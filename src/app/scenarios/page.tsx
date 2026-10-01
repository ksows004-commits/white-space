import Link from "next/link";

const scenarios = [
  { id: "a", name: "정상 부품", description: "결함 없음 — 전 구역 Pass" },
  { id: "b", name: "고응력부 결함 부품", description: "응력이 가장 높은 지점에 결함 — 일부 구역만 사용 가능(Conditional Pass)" },
  { id: "c", name: "재배치 가능 부품", description: "저응력 지점에 결함 — 재배치 시 사용 가능 여부 판정" },
];

export default function ScenariosPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">시나리오 선택</h1>
        <Link href="/" className="text-sm text-gray-600 underline">
          검사 회차 목록 →
        </Link>
      </div>
      <p className="mt-2 text-gray-600">
        파일 업로드 없이 미리 준비된 예시로 결과를 바로 확인할 수 있는 데모 화면입니다.
        실제 검사는 검사 회차 목록에서 파일을 업로드하세요.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {scenarios.map((scenario) => (
          <Link
            key={scenario.id}
            href={`/result/${scenario.id}`}
            className="rounded-lg border border-gray-300 bg-white p-6 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gray-700"
          >
            <h2 className="text-lg font-semibold">{scenario.name}</h2>
            <p className="mt-2 text-sm text-gray-600">{scenario.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
