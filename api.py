"""FastAPI service wrapping judge.py for the GPU server.

Serves POST-free GET /judge/{scenario_id}. Uses a MOCK case-1 stress CSV until the
real PrePoMax result arrives (see docs/fea-data-request.md) — swap the file named
in CASE1_FILE_CANDIDATES and this code keeps working unchanged, since defect
placement is picked dynamically from the stress distribution rather than hardcoded
coordinates.
"""

from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException

from judge import aggregate_nodes_to_panels, judge_zone, _read_node_csv

app = FastAPI()

DATA_DIR = Path(__file__).parent
CASE1_FILE_CANDIDATES = ["stress_case1_pressure.csv", "stress_case1_pressure_MOCK.csv"]

# docs/scenarios.md 규칙 그대로: 결함 위치는 좌표를 직접 박아두지 않고, 매번 불러온
# 응력 데이터에서 규칙("max"/"low_quartile" 등)에 맞는 패널을 찾아서 정한다.
# 그래서 MOCK 데이터를 실제 팀원 CSV로 바꿔도 이 로직은 그대로 재사용된다.
SCENARIO_DEFECTS = {
    "a": None,
    "b": {"rule": "max", "sqrt_area_um": 500, "location": "surface"},
    "c": {"rule": "low_quartile", "sqrt_area_um": 200, "location": "internal"},
}


def _load_case1_panels() -> tuple[pd.DataFrame, str]:
    for name in CASE1_FILE_CANDIDATES:
        path = DATA_DIR / name
        if path.exists():
            nodes = _read_node_csv(path)
            return aggregate_nodes_to_panels(nodes), name
    raise FileNotFoundError("case1 스트레스 CSV를 찾을 수 없습니다 (실제 또는 MOCK 파일 필요)")


def _pick_panel(panels: pd.DataFrame, rule: str) -> pd.Series:
    ordered = panels.sort_values("von_mises_mpa").reset_index(drop=True)
    if rule == "max":
        return ordered.iloc[-1]
    if rule == "low_quartile":
        return ordered.iloc[int(len(ordered) * 0.25)]
    if rule == "median":
        return ordered.iloc[len(ordered) // 2]
    raise ValueError(f"알 수 없는 defect 위치 규칙: {rule}")


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


@app.get("/health")
def health():
    return {"status": "ok"}
