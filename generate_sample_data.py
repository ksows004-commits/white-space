"""샘플 부품 검사 파일(CSV)을 실제 좌표 기준으로 생성한다.

실제 재고용 스크립트 — 필요하면 rules/sizes/locations만 바꿔서 언제든
새 샘플 파일을 다시 만들 수 있다.
"""

import csv
import random

import api

# "max"(응력 최댓값) 규칙은 항상 똑같은 구역 하나만 가리켜서, 크기만 다른
# 결함 여러 개를 넣으면 좌표가 전부 겹친다. 대신 응력 상위 N개 구역 중에서
# 무작위로 고른다 — 상위 4개까지는 판정 결과(Fail/Conditional 경계)가
# 동일하게 나오는 걸 확인했다 (2026-09-30 검증).
NEAR_MAX_TOP_N = 4


def _pick_near_max(panels, rng: random.Random):
    top = panels.sort_values("von_mises_mpa", ascending=False).head(NEAR_MAX_TOP_N)
    return top.iloc[rng.randrange(len(top))]


def make_file(path: str, picks: list[dict], prefix: str, rng: random.Random) -> None:
    panels, _source = api._load_case1_panels()
    rows = []
    for i, pick in enumerate(picks, start=1):
        if pick["rule"] == "near_max":
            target = _pick_near_max(panels, rng)
        else:
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
    make_file("sample-data/inspection_batch_normal.csv", normal, "NORM", rng)

    # 2) 혼합 배치 — Pass/Conditional Pass/Fail이 골고루 섞이도록
    mixed = [
        {"rule": "near_max", "size": 100, "location": "surface"},
        {"rule": "near_max", "size": 700, "location": "internal"},
        {"rule": "near_max", "size": 1800, "location": "surface"},
        {"rule": "q75", "size": 300, "location": "internal"},
        {"rule": "median", "size": 300, "location": "surface"},
        {"rule": "q25", "size": 100, "location": "internal"},
        {"rule": "min", "size": 100, "location": "surface"},
        {"rule": "near_max", "size": 1200, "location": "internal"},
        {"rule": "near_max", "size": 300, "location": "surface"},
        {"rule": "q75", "size": 1200, "location": "surface"},
    ]
    make_file("sample-data/inspection_batch_mixed.csv", mixed, "MIX", rng)

    # 3) 위험 배치 — 응력 집중부에 큰 결함들 -> Fail 다수
    critical = [
        {"rule": "near_max", "size": rng.choice([1800, 1200]), "location": rng.choice(["surface", "internal"])}
        for _ in range(10)
    ]
    make_file("sample-data/inspection_batch_critical.csv", critical, "CRIT", rng)


if __name__ == "__main__":
    main()
