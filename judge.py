from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterable, Mapping

import pandas as pd


PASS_MARGIN_RATIO = 0.20
LOCATION_COEFFICIENTS = {"surface": 1.43, "internal": 1.41}
REQUIRED_COLUMNS = {"node_id", "x_mm", "y_mm", "z_mm", "von_mises_mpa"}


def calculate_fatigue_limit_mpa(
    defect_sqrt_area_um: float, defect_location: str, hv: float = 400
) -> float:
    if defect_location not in LOCATION_COEFFICIENTS:
        raise ValueError("defect_location must be 'surface' or 'internal'")
    if defect_sqrt_area_um <= 0:
        raise ValueError("defect_sqrt_area_um must be greater than 0")
    if hv < 0:
        raise ValueError("hv must be 0 or greater")

    coefficient = LOCATION_COEFFICIENTS[defect_location]
    return coefficient * (hv + 120) / defect_sqrt_area_um ** (1 / 6)


def judge_zone(
    von_mises_stress_mpa: float,
    defect_sqrt_area_um: float,
    defect_location: str,
    hv: float = 400,
) -> str:
    if von_mises_stress_mpa < 0:
        raise ValueError("von_mises_stress_mpa must be 0 or greater")

    fatigue_limit = calculate_fatigue_limit_mpa(
        defect_sqrt_area_um, defect_location, hv
    )
    if fatigue_limit >= von_mises_stress_mpa * (1 + PASS_MARGIN_RATIO):
        return "Pass"
    if fatigue_limit >= von_mises_stress_mpa:
        return "Conditional Pass"
    return "Fail"


def _read_node_csv(input_csv_path: str | Path) -> pd.DataFrame:
    nodes = pd.read_csv(input_csv_path)
    missing_columns = REQUIRED_COLUMNS - set(nodes.columns)
    if missing_columns:
        missing = ", ".join(sorted(missing_columns))
        raise ValueError(f"Missing required CSV columns: {missing}")
    return nodes


def judge_csv(
    input_csv_path: str | Path,
    output_csv_path: str | Path,
    defect_sqrt_area_um: float,
    defect_location: str,
    hv: float = 400,
) -> pd.DataFrame:
    nodes = _read_node_csv(input_csv_path)
    nodes["judgment"] = nodes["von_mises_mpa"].apply(
        lambda stress: judge_zone(
            stress, defect_sqrt_area_um, defect_location, hv
        )
    )
    nodes.to_csv(output_csv_path, index=False)
    return nodes


def match_defects_to_nearest_nodes(
    input_csv_path: str | Path,
    defects: Iterable[Mapping[str, object]],
    hv: float = 400,
) -> pd.DataFrame:
    nodes = _read_node_csv(input_csv_path)
    matches = []

    for defect_index, defect in enumerate(defects, start=1):
        required = {"x_mm", "y_mm", "z_mm", "sqrt_area_um", "location"}
        missing = required - set(defect)
        if missing:
            names = ", ".join(sorted(missing))
            raise ValueError(f"Defect {defect_index} is missing fields: {names}")

        distances_squared = (
            (nodes["x_mm"] - float(defect["x_mm"])) ** 2
            + (nodes["y_mm"] - float(defect["y_mm"])) ** 2
            + (nodes["z_mm"] - float(defect["z_mm"])) ** 2
        )
        node = nodes.loc[distances_squared.idxmin()]
        sqrt_area_um = float(defect["sqrt_area_um"])
        location = str(defect["location"])

        matches.append(
            {
                "defect_index": defect_index,
                "node_id": node["node_id"],
                "distance_mm": distances_squared.min() ** 0.5,
                "von_mises_mpa": node["von_mises_mpa"],
                "defect_sqrt_area_um": sqrt_area_um,
                "defect_location": location,
                "judgment": judge_zone(
                    float(node["von_mises_mpa"]), sqrt_area_um, location, hv
                ),
            }
        )

    return pd.DataFrame(matches)


def _run_example() -> None:
    nodes = pd.DataFrame(
        [
            {"node_id": 1, "x_mm": 0, "y_mm": 0, "z_mm": 0, "von_mises_mpa": 300},
            {"node_id": 2, "x_mm": 10, "y_mm": 0, "z_mm": 0, "von_mises_mpa": 500},
            {"node_id": 3, "x_mm": 20, "y_mm": 0, "z_mm": 0, "von_mises_mpa": 700},
        ]
    )
    defects = [
        {"x_mm": 1, "y_mm": 0, "z_mm": 0, "sqrt_area_um": 100, "location": "surface"},
        {"x_mm": 18, "y_mm": 0, "z_mm": 0, "sqrt_area_um": 400, "location": "internal"},
    ]

    with TemporaryDirectory() as directory:
        input_path = Path(directory) / "example_input.csv"
        output_path = Path(directory) / "example_output.csv"
        nodes.to_csv(input_path, index=False)

        print("CSV judgment example")
        print(judge_csv(input_path, output_path, 100, "surface").to_string(index=False))
        print("\nNearest-node defect matches")
        print(match_defects_to_nearest_nodes(input_path, defects).to_string(index=False))


if __name__ == "__main__":
    _run_example()
