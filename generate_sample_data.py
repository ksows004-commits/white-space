"""샘플 부품 검사 파일(CSV)을 실제 좌표 기준으로 생성한다.

실제 재고용 스크립트 — 필요하면 rules/sizes/locations만 바꿔서 언제든
새 샘플 파일을 다시 만들 수 있다. (2026-10-01: 하중 4케이스 envelope
반영 후 재보정, 이후 판정 기준을 von Mises에서 최대주응력으로 교체하며
2차 재보정)
"""

import csv
import random

import api

# "max"(응력 최댓값) 구역은 극저온 하중 때문에 항복강도에 근접할 만큼 위험해서,
# 결함 크기와 거의 무관하게 Fail이 나온다 — 상위 4개 구역 중에서 무작위로 골라
# 좌표만 다양하게 한다.
NEAR_MAX_TOP_N = 4

# 87~93번째 백분위 구역 — 결함 크기에 따라 Pass/Conditional Pass가 갈리는
# "적당히 위험한" 구간. 여기서 무작위로 골라 Conditional Pass 예시를 만든다.
NEAR_P90_LOW, NEAR_P90_HIGH = 0.87, 0.93


def _pick_near_max(panels, rng: random.Random):
    top = panels.sort_values("von_mises_mpa", ascending=False).head(NEAR_MAX_TOP_N)
    return top.iloc[rng.randrange(len(top))]


def _pick_near_p90(panels, rng: random.Random):
    ordered = panels.sort_values("von_mises_mpa").reset_index(drop=True)
    n = len(ordered)
    band = ordered.iloc[int(n * NEAR_P90_LOW) : int(n * NEAR_P90_HIGH)]
    return band.iloc[rng.randrange(len(band))]


FIELDNAMES = ["serial_number", "x_mm", "y_mm", "z_mm", "sqrt_area_um", "location", "hv"]


def make_file(path: str, picks: list[dict], prefix: str, rng: random.Random) -> None:
    panels, _source = api._load_envelope_panels()
    rows = []
    for i, pick in enumerate(picks, start=1):
        if pick["rule"] == "near_max":
            target = _pick_near_max(panels, rng)
        elif pick["rule"] == "near_p90":
            target = _pick_near_p90(panels, rng)
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
                # 실측 경도값(측정 오차 감안, 인코넬718 대표값 400 주변 정상 편차)
                "hv": pick.get("hv", rng.randint(390, 410)),
            }
        )

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"{path}: {len(rows)} rows written")


def main() -> None:
    rng = random.Random(20261001)

    # 1) 정상 배치 — 전부 낮은/중간 응력 구역, 작은 결함 -> 대부분 Pass
    normal = [
        {"rule": rng.choice(["min", "q25", "median"]), "size": rng.choice([100, 300]), "location": rng.choice(["surface", "internal"])}
        for _ in range(10)
    ]
    make_file("sample-data/inspection_batch_normal.csv", normal, "NORM", rng)

    # 2) 혼합 배치 — Pass/Conditional Pass/Fail이 골고루 섞이도록.
    #    "p90"/"max"는 랜덤 없이 정확히 한 지점을 가리키는 결정론적 규칙이라
    #    (시나리오 B/C와 같은 방식) 여기 1개씩만 넣어 Conditional Pass/Fail을
    #    확정적으로 보장한다. 나머지는 근처 구역에서 무작위로 골라 좌표에
    #    변화를 준다 (결과는 대체로 Pass — 그래도 괜찮음, 목적은 다양성).
    mixed = [
        {"rule": "p90", "size": 400, "location": "internal", "hv": 400},  # 확정 Conditional Pass
        {"rule": "max", "size": 1800, "location": "surface", "hv": 400},  # 확정 Fail
        {"rule": "near_max", "size": 300, "location": "surface"},
        {"rule": "median", "size": 300, "location": "internal"},
        {"rule": "median", "size": 300, "location": "surface"},
        {"rule": "q25", "size": 100, "location": "internal"},
        {"rule": "min", "size": 100, "location": "surface"},
        {"rule": "near_p90", "size": 1200, "location": "internal"},
        {"rule": "near_p90", "size": 300, "location": "surface"},
        {"rule": "q25", "size": 700, "location": "surface"},
    ]
    make_file("sample-data/inspection_batch_mixed.csv", mixed, "MIX", rng)

    # 3) 위험 배치 — 응력 집중부(극저온 하중 영향) 위주 -> Fail 다수
    critical = [
        {"rule": "near_max", "size": rng.choice([100, 300, 700]), "location": rng.choice(["surface", "internal"])}
        for _ in range(10)
    ]
    make_file("sample-data/inspection_batch_critical.csv", critical, "CRIT", rng)

    # 4) 부품당 결함 여러 개 + 실측 경도값(hv) 예시 — serial_number가 같은 줄은
    #    같은 부품의 결함 여러 개. 부품의 최종 판정은 그중 가장 나쁜 결함 기준.
    make_multi_defect_file("sample-data/inspection_batch_multi_defect.csv", rng)


def make_multi_defect_file(path: str, rng: random.Random) -> None:
    panels, _source = api._load_envelope_panels()

    # (serial_number, [(rule, size, location, hv), ...])
    plan = [
        ("MD-01", [("median", 300, "surface", 395), ("near_p90", 700, "internal", 395)]),
        ("MD-02", [("near_max", 300, "surface", 410)]),
        ("MD-03", [("q25", 100, "internal", 405), ("min", 100, "surface", 405)]),
        ("MD-04", [("near_p90", 1800, "surface", 390), ("median", 300, "internal", 390)]),
        ("MD-05", [("near_max", 100, "internal", 400), ("near_max", 300, "surface", 400)]),
    ]

    rows = []
    for serial, defects in plan:
        for rule, size, location, hv in defects:
            if rule == "near_max":
                target = _pick_near_max(panels, rng)
            elif rule == "near_p90":
                target = _pick_near_p90(panels, rng)
            else:
                target = api._pick_panel(panels, rule)
            rows.append(
                {
                    "serial_number": serial,
                    "x_mm": round(float(target["x_mm"]), 4),
                    "y_mm": round(float(target["y_mm"]), 4),
                    "z_mm": round(float(target["z_mm"]), 4),
                    "sqrt_area_um": size,
                    "location": location,
                    "hv": hv,
                }
            )

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"{path}: {len(rows)} rows written ({len(plan)} parts)")


if __name__ == "__main__":
    main()
