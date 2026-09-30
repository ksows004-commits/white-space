import Link from "next/link";

const scenarios = [
  { id: "a", name: "시나리오 A", description: "내부 압력 하중과 가상 결함 조합 (목업)" },
  { id: "b", name: "시나리오 B", description: "축방향 추력 하중과 가상 결함 조합 (목업)" },
  { id: "c", name: "시나리오 C", description: "횡방향 하중과 가상 결함 조합 (목업)" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold">시나리오 선택</h1>
      <p className="mt-2 text-gray-600">분석 결과를 확인할 부품 시나리오를 선택하세요.</p>
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
