"""샘플 부품 검사 파일(CSV)을 실제 좌표 기준으로 생성한다.

실제 재고용 스크립트 — 필요하면 rules/sizes/locations만 바꿔서 언제든
새 샘플 파일을 다시 만들 수 있다.
"""

import csv
import random

import api


def make_file(path: str, picks: list[dict], prefix: str) -> None:
    panels, _source = api._load_case1_panels()
    rows = []
    for i, pick in enumerate(picks, start=1):
        target = api._pick_panel(panels, pick["rule"])
        rows.append(
            {
                "serial_number": f"{prefix}-{i:02d}",
                "x_mm": round(float(target["x_mm"]), 4),
                "y_mm": round(float(target["y_mm"]), 4),
                "z_mm": round(float(target["z_mm"]), 4),
                "sqrt_area_um": pick["size"],
                "location": pick["location"],
            }
        )

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["serial_number", "x_mm", "y_mm", "z_mm", "sqrt_area_um", "location"]
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"{path}: {len(rows)}개 부품 작성")


def main() -> None:
    rng = random.Random(20261001)

    # 1) 정상 배치 — 전부 낮은/중간 응력 구역, 작은 결함 -> 대부분 Pass
    normal = [
        {"rule": rng.choice(["min", "q25", "median"]), "size": rng.choice([100, 300]), "location": rng.choice(["surface", "internal"])}
        for _ in range(10)
    ]
    make_file("sample-data/inspection_batch_normal.csv", normal, "NORM")

    # 2) 혼합 배치 — Pass/Conditional Pass/Fail이 골고루 섞이도록
    mixed = [
        {"rule": "max", "size": 100, "location": "surface"},
        {"rule": "max", "size": 700, "location": "internal"},
        {"rule": "max", "size": 1800, "location": "surface"},
        {"rule": "q75", "size": 300, "location": "internal"},
        {"rule": "median", "size": 300, "location": "surface"},
        {"rule": "q25", "size": 100, "location": "internal"},
        {"rule": "min", "size": 100, "location": "surface"},
        {"rule": "max", "size": 1200, "location": "internal"},
        {"rule": "max", "size": 300, "location": "surface"},
        {"rule": "q75", "size": 1200, "location": "surface"},
    ]
    make_file("sample-data/inspection_batch_mixed.csv", mixed, "MIX")

    # 3) 위험 배치 — 응력 집중부에 큰 결함들 -> Fail 다수
    critical = [
        {"rule": "max", "size": rng.choice([1800, 1200]), "location": rng.choice(["surface", "internal"])}
        for _ in range(10)
    ]
    make_file("sample-data/inspection_batch_critical.csv", critical, "CRIT")


if __name__ == "__main__":
    main()
