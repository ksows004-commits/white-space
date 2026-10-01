"""샘플 부품 검사 파일(CSV)을 실제 좌표 기준으로 생성한다.

2026-10-02 전면 재작성: 판정 체계가 "116개 설치 구역 커버리지" 기준으로
바뀐 뒤 실측해보니, 테스트한 모든 현실적 결함 크기(100~1800um)가 어느
위치에 있든 거의 항상 Conditional Pass로 판정된다. Pass를 받으려면
결함이 아예 없어야 하고(업로드 CSV에서 결함 칸을 비워두면 지원됨 —
src/app/api/batches/upload/route.ts 참고), Fail을 받으려면 결함이
sqrt_area_um 기준 10^14 단위로 커야 해서(지구-달 거리급) 현실적으로
의미가 없다 — 그래서 이 샘플 데이터는 Pass/Conditional Pass 두 가지만
"현실적인 비율"로 생성하고, Fail은 의도적으로 넣지 않는다(지어낸 수치로
Fail을 만들지 않는다는 원칙 적용).
"""

import csv
import random

import api

FIELDNAMES = ["serial_number", "x_mm", "y_mm", "z_mm", "sqrt_area_um", "location", "hv"]
DEFECT_SIZES_UM = [100, 200, 300, 500, 700, 900, 1200, 1500, 1800]


def make_realistic_batch(
    path: str, prefix: str, total_parts: int, conditional_fraction: float, rng: random.Random
) -> None:
    panels, _source = api._load_envelope_panels()
    n_conditional = round(total_parts * conditional_fraction)
    n_pass = total_parts - n_conditional

    serials = [f"{prefix}-{i:02d}" for i in range(1, total_parts + 1)]
    rng.shuffle(serials)
    pass_serials = set(serials[:n_pass])

    rows = []
    for serial in serials:
        if serial in pass_serials:
            # 결함 칸을 전부 비워서 "검사했지만 결함 없음"으로 표시(Pass).
            rows.append({field: "" for field in FIELDNAMES} | {"serial_number": serial})
            continue
        # 대부분 결함 1개, 15% 확률로 2개(부품 하나에 결함 여러 개 메커니즘도
        # 함께 보여줌). 결함 위치는 실제 패널 좌표 중 무작위 — 테스트 결과
        # 어느 위치를 고르든 거의 항상 Conditional Pass로 귀결되므로, 특정
        # 규칙(p90/max 등)으로 고를 필요 없이 실제 좌표를 그대로 쓴다.
        n_defects = 2 if rng.random() < 0.15 else 1
        for _ in range(n_defects):
            panel = panels.iloc[rng.randrange(len(panels))]
            rows.append({
                "serial_number": serial,
                "x_mm": round(float(panel["x_mm"]), 4),
                "y_mm": round(float(panel["y_mm"]), 4),
                "z_mm": round(float(panel["z_mm"]), 4),
                "sqrt_area_um": rng.choice(DEFECT_SIZES_UM),
                "location": rng.choice(["surface", "internal"]),
                "hv": rng.randint(390, 410),
            })

    # CSV 안에서 같은 serial_number끼리는 붙어 있도록, 원래 뽑은 순서로 정렬.
    order = {serial: i for i, serial in enumerate(serials)}
    rows.sort(key=lambda row: order[row["serial_number"]])

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"{path}: {len(rows)}줄, 부품 {total_parts}개 (Pass {n_pass} / Conditional Pass {n_conditional} 목표)")


def main() -> None:
    rng = random.Random(20261002)
    # 세 파일을 비율만 다르게 만들어서, 업로드할 때마다 조금씩 다른 "하루치
    # 생산 배치" 느낌이 나도록 함. 전부 Pass 위주 + Conditional Pass가
    # 상당수 섞이는 현실적인 구성(Fail 없음, 위 모듈 docstring 참고).
    make_realistic_batch("sample-data/inspection_batch_realistic_1.csv", "RB1", 30, 0.20, rng)
    make_realistic_batch("sample-data/inspection_batch_realistic_2.csv", "RB2", 30, 0.30, rng)
    make_realistic_batch("sample-data/inspection_batch_realistic_3.csv", "RB3", 25, 0.45, rng)


if __name__ == "__main__":
    main()
