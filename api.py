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
from pydantic import BaseModel

from judge import aggregate_nodes_to_panels, judge_zone, _read_node_csv

app = FastAPI()

DATA_DIR = Path(__file__).parent

# 4개 하중 케이스 전부 로드해서 "envelope"(구역별로 4개 중 가장 나쁜 응력값)를
# 쓴다. 부품은 비행 중 이 모든 조건을 다 겪으므로, 하나라도 못 버티면 위험하다는
# 보수적 접근. 팀원이 케이스1(내부압력)만 먼저 보내줬을 수 있으니 파일이 없는
# 케이스는 건너뛴다.
CASE_FILE_CANDIDATES = {
    "case1_pressure": ["stress_case1_pressure.csv", "stress_case1_pressure_MOCK.csv"],
    "case2_thrust": ["stress_case2_thrust.csv"],
    "case3_vibration": ["stress_case3_vibration.csv"],
    "case4_cryo": ["stress_case4_cryo.csv"],
}

# docs/scenarios.md 규칙 그대로: 결함 위치는 좌표를 직접 박아두지 않고, 매번 불러온
# 응력 데이터에서 규칙("max"/"q25" 등)에 맞는 패널을 찾아서 정한다.
# 그래서 MOCK 데이터를 실제 팀원 CSV로 바꿔도 이 로직은 그대로 재사용된다.
# 4개 하중 케이스 envelope(2026-10-01 반영) 기준으로 재보정한 값.
# "max" 구역은 극저온(case4) 하중에서 응력이 1000MPa를 넘어 항복강도에 근접 —
# 결함이 없다시피 해도(√area 100) 무조건 Fail이 나올 만큼 그 자체로 위험한
# 지점이다. "그 지점은 결함 크기와 무관하게 위험하다"는 게 실제 계산 결과라
# 그대로 시나리오 B에 쓴다. C는 그보다 덜 위험한 90번째 백분위 구역(p90)에서
# 결함 크기로 Conditional Pass가 나오도록 보정했다.
SCENARIO_DEFECTS = {
    "a": None,
    "b": {"rule": "max", "sqrt_area_um": 300, "location": "surface"},
    "c": {"rule": "p90", "sqrt_area_um": 900, "location": "internal"},
}

# 배치 검사용 "정형화된 결함 풀" — 완전 무작위 대신, 규칙 5개 x 결함 크기 5단계 x
# 위치 종류 2가지 = 50개를 미리 체계적으로 만들어두고 그중 일부를 뽑아서 쓴다.
POOL_RULES = ["min", "q25", "median", "p90", "max"]
POOL_SIZES_UM = [100, 300, 700, 1200, 1800]
POOL_LOCATIONS = ["surface", "internal"]


def _defect_pool() -> list[dict]:
    return [
        {"rule": rule, "sqrt_area_um": size, "location": location}
        for rule, size, location in itertools.product(
            POOL_RULES, POOL_SIZES_UM, POOL_LOCATIONS
        )
    ]


def _load_one_case(candidates: list[str]) -> Optional[tuple[pd.DataFrame, str]]:
    for name in candidates:
        path = DATA_DIR / name
        if path.exists():
            nodes = _read_node_csv(path)
            return aggregate_nodes_to_panels(nodes), name
    return None


_envelope_cache: Optional[tuple[pd.DataFrame, list[str]]] = None


def _load_envelope_panels() -> tuple[pd.DataFrame, list[str]]:
    """4개 하중 케이스를 전부 불러와 구역(panel_id)별로 가장 나쁜(최댓값) 응력을
    합친 결과를 반환한다. 첫 호출 때만 계산하고 이후엔 캐시를 재사용한다
    (케이스당 30만+ 행이라 매 요청마다 다시 읽으면 느림)."""
    global _envelope_cache
    if _envelope_cache is not None:
        return _envelope_cache

    loaded: list[tuple[pd.DataFrame, str]] = []
    for candidates in CASE_FILE_CANDIDATES.values():
        result = _load_one_case(candidates)
        if result is not None:
            loaded.append(result)

    if not loaded:
        raise FileNotFoundError("하중 케이스 CSV를 하나도 찾을 수 없습니다")

    envelope, source = loaded[0][0].copy(), [loaded[0][1]]
    for panels, name in loaded[1:]:
        merged = envelope.merge(
            panels[["panel_id", "von_mises_mpa"]], on="panel_id", suffixes=("", "_other")
        )
        envelope["von_mises_mpa"] = merged[["von_mises_mpa", "von_mises_mpa_other"]].max(axis=1)
        source.append(name)

    _envelope_cache = (envelope, source)
    return _envelope_cache


_RULE_PERCENTILE = {"min": 0.0, "q25": 0.25, "median": 0.5, "p90": 0.90, "max": 1.0}


def _pick_panel(panels: pd.DataFrame, rule: str) -> pd.Series:
    if rule not in _RULE_PERCENTILE:
        raise ValueError(f"알 수 없는 defect 위치 규칙: {rule}")
    ordered = panels.sort_values("von_mises_mpa").reset_index(drop=True)
    idx = min(int(len(ordered) * _RULE_PERCENTILE[rule]), len(ordered) - 1)
    return ordered.iloc[idx]


def _nearest_panel(panels: pd.DataFrame, x_mm: float, y_mm: float, z_mm: float) -> pd.Series:
    """업로드된 파일의 실제 좌표에 가장 가까운 패널(구역)을 찾는다."""
    dist_sq = (panels["x_mm"] - x_mm) ** 2 + (panels["y_mm"] - y_mm) ** 2 + (panels["z_mm"] - z_mm) ** 2
    return panels.loc[dist_sq.idxmin()]


_JUDGMENT_SEVERITY = {"Pass": 0, "Conditional Pass": 1, "Fail": 2}


def _worst_judgment(judgments: list[str]) -> str:
    return max(judgments, key=lambda j: _JUDGMENT_SEVERITY[j])


def _judge_at_panel(
    panels_base: pd.DataFrame,
    target_panel: pd.Series,
    sqrt_area_um: float,
    location: str,
    hv: float = 400,
) -> dict:
    """결함 하나가 이미 정해진 패널(target_panel)에 있다고 할 때 판정과
    재배치 지도를 계산한다 (규칙으로 골랐든 실제 좌표로 찾았든 동일)."""
    judgment = judge_zone(float(target_panel["von_mises_mpa"]), sqrt_area_um, location, hv)

    panel_judgments = panels_base["von_mises_mpa"].apply(
        lambda stress: judge_zone(float(stress), sqrt_area_um, location, hv)
    )

    defect_info = {
        "panel_id": target_panel["panel_id"],
        "x_mm": float(target_panel["x_mm"]),
        "y_mm": float(target_panel["y_mm"]),
        "z_mm": float(target_panel["z_mm"]),
        "sqrt_area_um": sqrt_area_um,
        "location": location,
        "judgment": judgment,
    }

    return {"defect_info": defect_info, "panel_judgments": panel_judgments}


def _combine_defects(panels_base: pd.DataFrame, defect_results: list[dict]) -> dict:
    """부품 하나에 딸린 결함 여러 개(defect_results)를 하나의 결과로 합친다.

    - panels: 결함이 있는 구역들만 각자의 판정으로 표시, 나머지는 Pass
    - reassignment: 구역마다 "이 부품의 결함 전부가 거기 있었어도 괜찮은지"
      (결함 중 가장 나쁜 경우 기준 — 보수적으로 합산)
    - worst_judgment: 결함들 중 가장 나쁜 판정
    """
    panels = panels_base.copy()
    panels["judgment"] = "Pass"
    for d in defect_results:
        info = d["defect_info"]
        panels.loc[panels["panel_id"] == info["panel_id"], "judgment"] = info["judgment"]

    reassignment = panels_base.copy()
    combined = pd.concat([d["panel_judgments"] for d in defect_results], axis=1)
    reassignment["judgment"] = combined.apply(
        lambda row: _worst_judgment(list(row)), axis=1
    )
    usable_count = int((reassignment["judgment"] != "Fail").sum())

    worst = _worst_judgment([d["defect_info"]["judgment"] for d in defect_results])

    return {
        "defect_info": [d["defect_info"] for d in defect_results],
        "panels": panels,
        "reassignment": reassignment,
        "summary": {
            "worst_judgment": worst,
            "affected_panel_id": next(
                d["defect_info"]["panel_id"]
                for d in defect_results
                if d["defect_info"]["judgment"] == worst
            ),
            "usable_zone_count": usable_count,
            "total_zone_count": int(len(panels_base)),
        },
    }


def _no_defect_result(panels_base: pd.DataFrame) -> dict:
    panels = panels_base.copy()
    panels["judgment"] = "Pass"
    return {
        "defect_info": [],
        "panels": panels,
        "reassignment": panels.copy(),
        "summary": {
            "worst_judgment": "Pass",
            "affected_panel_id": None,
            "usable_zone_count": int(len(panels_base)),
            "total_zone_count": int(len(panels_base)),
        },
    }


def _apply_defect(panels_base: pd.DataFrame, defect_config: Optional[dict]) -> dict:
    """규칙("max"/"q25" 등) 기반으로 결함 위치를 정하는 경로 — 시나리오 A/B/C와
    배치용 결함 풀에서 사용 (부품당 결함 1개)."""
    if defect_config is None:
        return _no_defect_result(panels_base)
    target_panel = _pick_panel(panels_base, defect_config["rule"])
    one = _judge_at_panel(
        panels_base, target_panel, defect_config["sqrt_area_um"], defect_config["location"]
    )
    return _combine_defects(panels_base, [one])


@app.get("/judge/{scenario_id}")
def judge_scenario(scenario_id: str):
    scenario_id = scenario_id.lower()
    if scenario_id not in SCENARIO_DEFECTS:
        raise HTTPException(status_code=404, detail=f"알 수 없는 scenario_id: {scenario_id}")

    panels_base, source = _load_envelope_panels()
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

    panels_base, source = _load_envelope_panels()
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


class UploadedDefect(BaseModel):
    serial_number: str
    x_mm: float
    y_mm: float
    z_mm: float
    sqrt_area_um: float
    location: str
    hv: float = 400  # 실측 경도값이 없으면 인코넬718 대표값(400) 사용


class UploadBatch(BaseModel):
    defects: list[UploadedDefect]


@app.post("/judge_defects")
def judge_defects(body: UploadBatch):
    """업로드된 실제 검사 파일을 판정한다. /judge_batch와 달리 결함 위치를
    규칙으로 고르지 않고 파일에 적힌 실제 좌표로 찾는다. 같은 serial_number를
    가진 행이 여러 개면 "부품 하나에 결함 여러 개"로 묶어서, 그 부품의
    최종 판정은 결함들 중 가장 나쁜 것으로 정한다."""
    if not body.defects:
        raise HTTPException(status_code=400, detail="defects가 비어 있습니다")
    if any(d.location not in ("surface", "internal") for d in body.defects):
        raise HTTPException(
            status_code=400, detail="location은 'surface' 또는 'internal'이어야 합니다"
        )

    panels_base, source = _load_envelope_panels()

    by_serial: dict[str, list[UploadedDefect]] = {}
    for d in body.defects:
        by_serial.setdefault(d.serial_number, []).append(d)

    parts = []
    for serial_number, defects in by_serial.items():
        per_defect = []
        for d in defects:
            target_panel = _nearest_panel(panels_base, d.x_mm, d.y_mm, d.z_mm)
            per_defect.append(
                _judge_at_panel(panels_base, target_panel, d.sqrt_area_um, d.location, d.hv)
            )
        result = _combine_defects(panels_base, per_defect)
        parts.append(
            {
                "serial_number": serial_number,
                "defect": result["defect_info"],
                "panels": result["panels"].to_dict("records"),
                "reassignment": result["reassignment"].to_dict("records"),
                "summary": result["summary"],
            }
        )

    return {"data_source": source, "parts": parts}


@app.get("/health")
def health():
    return {"status": "ok"}
