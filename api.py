"""FastAPI service wrapping judge.py for the GPU server.

Serves POST-free GET /judge/{scenario_id}. Uses a MOCK case-1 stress CSV until the
real PrePoMax result arrives (see docs/fea-data-request.md) — swap the file named
in CASE1_FILE_CANDIDATES and this code keeps working unchanged, since defect
placement is picked dynamically from the stress distribution rather than hardcoded
coordinates.
"""

import itertools
import random
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException

from judge import aggregate_nodes_to_panels, judge_zone, _read_node_csv

app = FastAPI()

DATA_DIR = Path(__file__).parent
CASE1_FILE_CANDIDATES = ["stress_case1_pressure.csv", "stress_case1_pressure_MOCK.csv"]

# docs/scenarios.md 규칙 그대로: 결함 위치는 좌표를 직접 박아두지 않고, 매번 불러온
# 응력 데이터에서 규칙("max"/"q25" 등)에 맞는 패널을 찾아서 정한다.
# 그래서 MOCK 데이터를 실제 팀원 CSV로 바꿔도 이 로직은 그대로 재사용된다.
SCENARIO_DEFECTS = {
    "a": None,
    "b": {"rule": "max", "sqrt_area_um": 500, "location": "surface"},
    "c": {"rule": "q25", "sqrt_area_um": 200, "location": "internal"},
}

# 배치 검사용 "정형화된 결함 풀" — 완전 무작위 대신, 규칙 5개 x 결함 크기 5단계 x
# 위치 종류 2가지 = 50개를 미리 체계적으로 만들어두고 그중 일부를 뽑아서 쓴다.
POOL_RULES = ["min", "q25", "median", "q75", "max"]
POOL_SIZES_UM = [100, 200, 300, 400, 500]
POOL_LOCATIONS = ["surface", "internal"]


def _defect_pool() -> list[dict]:
    return [
        {"rule": rule, "sqrt_area_um": size, "location": location}
        for rule, size, location in itertools.product(
            POOL_RULES, POOL_SIZES_UM, POOL_LOCATIONS
        )
    ]


def _load_case1_panels() -> tuple[pd.DataFrame, str]:
    for name in CASE1_FILE_CANDIDATES:
        path = DATA_DIR / name
        if path.exists():
            nodes = _read_node_csv(path)
            return aggregate_nodes_to_panels(nodes), name
    raise FileNotFoundError("case1 스트레스 CSV를 찾을 수 없습니다 (실제 또는 MOCK 파일 필요)")


_RULE_PERCENTILE = {"min": 0.0, "q25": 0.25, "median": 0.5, "q75": 0.75, "max": 1.0}


def _pick_panel(panels: pd.DataFrame, rule: str) -> pd.Series:
    if rule not in _RULE_PERCENTILE:
        raise ValueError(f"알 수 없는 defect 위치 규칙: {rule}")
    ordered = panels.sort_values("von_mises_mpa").reset_index(drop=True)
    idx = min(int(len(ordered) * _RULE_PERCENTILE[rule]), len(ordered) - 1)
    return ordered.iloc[idx]


@app.get("/judge/{scenario_id}")
def judge_scenario(scenario_id: str):
    scenario_id = scenario_id.lower()
    if scenario_id not in SCENARIO_DEFECTS:
        raise HTTPException(status_code=404, detail=f"알 수 없는 scenario_id: {scenario_id}")

    panels, source = _load_case1_panels()
    panels = panels.copy()
    panels["judgment"] = "Pass"  # 결함이 없는 패널은 기본적으로 Pass

    defect_config = SCENARIO_DEFECTS[scenario_id]
    defect_info: Optional[dict] = None

    if defect_config is not None:
        target_panel = _pick_panel(panels, defect_config["rule"])
        judgment = judge_zone(
            float(target_panel["von_mises_mpa"]),
            defect_config["sqrt_area_um"],
            defect_config["location"],
        )
        panels.loc[panels["panel_id"] == target_panel["panel_id"], "judgment"] = judgment
        defect_info = {
            "panel_id": target_panel["panel_id"],
            "x_mm": float(target_panel["x_mm"]),
            "y_mm": float(target_panel["y_mm"]),
            "z_mm": float(target_panel["z_mm"]),
            "sqrt_area_um": defect_config["sqrt_area_um"],
            "location": defect_config["location"],
        }

    # 결함이 없으면 전부 Pass이므로, 결함이 있는 패널의 판정이 곧 전체 최악 판정이다.
    # (여러 패널이 같은 "Pass"로 동점일 때 임의의 패널이 골라지는 문제를 피하기 위해
    # panels 전체를 다시 스캔하지 않고 defect_info로 직접 결정한다.)
    if defect_info is None:
        summary = {"worst_judgment": "Pass", "affected_panel_id": None}
    else:
        summary = {"worst_judgment": judgment, "affected_panel_id": defect_info["panel_id"]}

    return {
        "scenario_id": scenario_id,
        "data_source": source,
        "panels": panels.to_dict("records"),
        "defect": defect_info,
        "summary": summary,
    }


@app.get("/judge_batch")
def judge_batch(count: int = 10, seed: int = 42):
    """정형화된 결함 풀(50개)에서 seed 기반으로 count개를 뽑아 한 번에 판정한다.

    시연 리허설과 실제 촬영 때 같은 seed면 항상 같은 결과가 나오도록,
    진짜 무작위 대신 파이썬 random.Random(seed)로 고정한다.
    """
    pool = _defect_pool()
    if not 1 <= count <= len(pool):
        raise HTTPException(
            status_code=400, detail=f"count는 1~{len(pool)} 사이여야 합니다"
        )

    panels_base, source = _load_case1_panels()
    sampled = random.Random(seed).sample(pool, count)

    parts = []
    for i, defect_config in enumerate(sampled, start=1):
        target_panel = _pick_panel(panels_base, defect_config["rule"])
        part_judgment = judge_zone(
            float(target_panel["von_mises_mpa"]),
            defect_config["sqrt_area_um"],
            defect_config["location"],
        )

        panels = panels_base.copy()
        panels["judgment"] = "Pass"
        panels.loc[panels["panel_id"] == target_panel["panel_id"], "judgment"] = part_judgment

        # 재배치 가능 위치: 이 결함을 부품 위 다른 모든 구역으로 옮겼다고 가정했을 때
        # 각 구역에서의 판정. "어디에 쓸 수 있고 어디에 못 쓰는지"에 대한 답.
        reassignment = panels_base.copy()
        reassignment["judgment"] = reassignment["von_mises_mpa"].apply(
            lambda stress, cfg=defect_config: judge_zone(
                float(stress), cfg["sqrt_area_um"], cfg["location"]
            )
        )
        usable_count = int((reassignment["judgment"] != "Fail").sum())

        parts.append(
            {
                "serial_number": f"WS-{seed}-{i:02d}",
                "defect": {
                    "panel_id": target_panel["panel_id"],
                    "x_mm": float(target_panel["x_mm"]),
                    "y_mm": float(target_panel["y_mm"]),
                    "z_mm": float(target_panel["z_mm"]),
                    "sqrt_area_um": defect_config["sqrt_area_um"],
                    "location": defect_config["location"],
                },
                "panels": panels.to_dict("records"),
                "reassignment": reassignment.to_dict("records"),
                "summary": {
                    "worst_judgment": part_judgment,
                    "affected_panel_id": target_panel["panel_id"],
                    "usable_zone_count": usable_count,
                    "total_zone_count": int(len(panels_base)),
                },
            }
        )

    return {"seed": seed, "data_source": source, "parts": parts}


@app.get("/health")
def health():
    return {"status": "ok"}
