"""FastAPI service wrapping judge.py for the GPU server.

Serves GET /judge/{scenario_id} and GET /judge_batch. Reads real PrePoMax case-1
stress data (converted from .frd via frd_to_csv.py) — falls back to a MOCK CSV if
the real file isn't present. Defect placement is picked dynamically from the
stress distribution (see docs/scenarios.md) rather than hardcoded coordinates.
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
# 실제 데이터(내부압력 5MPa) 기준으로 보정한 값. 응력 최댓값 구역(max) 외에는
# 어떤 결함 크기를 넣어도 사실상 전부 Pass로 나올 만큼 부품이 튼튼해서,
# Fail/Conditional Pass를 보여주려면 응력 집중부(max)에서 크기를 키워야 한다.
SCENARIO_DEFECTS = {
    "a": None,
    "b": {"rule": "max", "sqrt_area_um": 1800, "location": "surface"},
    "c": {"rule": "max", "sqrt_area_um": 700, "location": "internal"},
}

# 배치 검사용 "정형화된 결함 풀" — 완전 무작위 대신, 규칙 5개 x 결함 크기 5단계 x
# 위치 종류 2가지 = 50개를 미리 체계적으로 만들어두고 그중 일부를 뽑아서 쓴다.
POOL_RULES = ["min", "q25", "median", "q75", "max"]
POOL_SIZES_UM = [100, 300, 700, 1200, 1800]
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


def _apply_defect(panels_base: pd.DataFrame, defect_config: Optional[dict]) -> dict:
    """결함 하나를 패널 데이터에 적용해서, 결과 화면에 필요한 모든 걸 계산한다.

    - panels: "실제 이 부품"의 지도 (결함 있는 구역 하나만 판정, 나머지는 Pass)
    - reassignment: 이 결함을 다른 모든 구역으로 옮겼다고 가정했을 때의 지도
      ("어디에 재배치해서 쓸 수 있는지"에 대한 답)
    """
    panels = panels_base.copy()
    panels["judgment"] = "Pass"

    if defect_config is None:
        reassignment = panels_base.copy()
        reassignment["judgment"] = "Pass"
        return {
            "defect_info": None,
            "panels": panels,
            "reassignment": reassignment,
            "summary": {
                "worst_judgment": "Pass",
                "affected_panel_id": None,
                "usable_zone_count": int(len(panels_base)),
                "total_zone_count": int(len(panels_base)),
            },
        }

    target_panel = _pick_panel(panels_base, defect_config["rule"])
    judgment = judge_zone(
        float(target_panel["von_mises_mpa"]),
        defect_config["sqrt_area_um"],
        defect_config["location"],
    )
    panels.loc[panels["panel_id"] == target_panel["panel_id"], "judgment"] = judgment

    reassignment = panels_base.copy()
    reassignment["judgment"] = reassignment["von_mises_mpa"].apply(
        lambda stress: judge_zone(
            float(stress), defect_config["sqrt_area_um"], defect_config["location"]
        )
    )
    usable_count = int((reassignment["judgment"] != "Fail").sum())

    defect_info = {
        "panel_id": target_panel["panel_id"],
        "x_mm": float(target_panel["x_mm"]),
        "y_mm": float(target_panel["y_mm"]),
        "z_mm": float(target_panel["z_mm"]),
        "sqrt_area_um": defect_config["sqrt_area_um"],
        "location": defect_config["location"],
    }

    return {
        "defect_info": defect_info,
        "panels": panels,
        "reassignment": reassignment,
        "summary": {
            "worst_judgment": judgment,
            "affected_panel_id": defect_info["panel_id"],
            "usable_zone_count": usable_count,
            "total_zone_count": int(len(panels_base)),
        },
    }


@app.get("/judge/{scenario_id}")
def judge_scenario(scenario_id: str):
    scenario_id = scenario_id.lower()
    if scenario_id not in SCENARIO_DEFECTS:
        raise HTTPException(status_code=404, detail=f"알 수 없는 scenario_id: {scenario_id}")

    panels_base, source = _load_case1_panels()
    result = _apply_defect(panels_base, SCENARIO_DEFECTS[scenario_id])

    return {
        "scenario_id": scenario_id,
        "data_source": source,
        "panels": result["panels"].to_dict("records"),
        "reassignment": result["reassignment"].to_dict("records"),
        "defect": result["defect_info"],
        "summary": result["summary"],
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
        result = _apply_defect(panels_base, defect_config)
        parts.append(
            {
                "serial_number": f"WS-{seed}-{i:02d}",
                "defect": result["defect_info"],
                "panels": result["panels"].to_dict("records"),
                "reassignment": result["reassignment"].to_dict("records"),
                "summary": result["summary"],
            }
        )

    return {"seed": seed, "data_source": source, "parts": parts}


@app.get("/health")
def health():
    return {"status": "ok"}
