import math
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
    pass_threshold = von_mises_stress_mpa * (1 + PASS_MARGIN_RATIO)
    if fatigue_limit >= pass_threshold or math.isclose(fatigue_limit, pass_threshold):
        return "Pass"
    if fatigue_limit >= von_mises_stress_mpa or math.isclose(
        fatigue_limit, von_mises_stress_mpa
    ):
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


def assign_grid_cell(
    x_mm: float, y_mm: float, z_mm: float, grid_size_mm: float = 25
) -> tuple[int, int, int]:
    """Return the grid indices for a node, using floor also for negatives."""
    if not math.isfinite(grid_size_mm) or grid_size_mm <= 0:
        raise ValueError("grid_size_mm must be finite and greater than 0")
    return (
        math.floor(x_mm / grid_size_mm),
        math.floor(y_mm / grid_size_mm),
        math.floor(z_mm / grid_size_mm),
    )


def aggregate_nodes_to_panels(
    nodes_df: pd.DataFrame, grid_size_mm: float = 25
) -> pd.DataFrame:
    """Group nodes by grid cell and retain the maximum stress per panel."""
    assign_grid_cell(0, 0, 0, grid_size_mm)
    missing_columns = REQUIRED_COLUMNS - set(nodes_df.columns)
    if missing_columns:
        missing = ", ".join(sorted(missing_columns))
        raise ValueError(f"Missing required DataFrame columns: {missing}")

    nodes = nodes_df.copy()
    nodes["panel_id"] = [
        "_".join(str(index) for index in assign_grid_cell(x, y, z, grid_size_mm))
        for x, y, z in nodes[["x_mm", "y_mm", "z_mm"]].itertuples(
            index=False, name=None
        )
    ]
    return nodes.groupby("panel_id", as_index=False).agg(
        node_count=("node_id", "size"),
        x_mm=("x_mm", "mean"),
        y_mm=("y_mm", "mean"),
        z_mm=("z_mm", "mean"),
        von_mises_mpa=("von_mises_mpa", "max"),
    )


def judge_panels_csv(
    input_csv_path: str | Path,
    output_csv_path: str | Path,
    grid_size_mm: float = 25,
    defect_sqrt_area_um: float | None = None,
    defect_location: str | None = None,
    hv: float = 400,
) -> pd.DataFrame:
    """Save panel aggregates, optionally judged using the supplied defect."""
    if (defect_sqrt_area_um is None) != (defect_location is None):
        raise ValueError("Provide both defect_sqrt_area_um and defect_location, or neither")
    panels = aggregate_nodes_to_panels(_read_node_csv(input_csv_path), grid_size_mm)
    if defect_sqrt_area_um is not None and defect_location is not None:
        panels["judgment"] = panels["von_mises_mpa"].apply(
            lambda stress: judge_zone(stress, defect_sqrt_area_um, defect_location, hv)
        )
    panels.to_csv(output_csv_path, index=False)
    return panels


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

        panel_nodes = pd.concat(
            [
                nodes,
                pd.DataFrame([
                    {"node_id": 4, "x_mm": 25, "y_mm": 5, "z_mm": 0, "von_mises_mpa": 200},
                    {"node_id": 5, "x_mm": 35, "y_mm": 15, "z_mm": 0, "von_mises_mpa": 400},
                ]),
            ],
            ignore_index=True,
        )
        panel_input_path = Path(directory) / "example_panel_input.csv"
        panel_output_path = Path(directory) / "example_panels.csv"
        panel_nodes.to_csv(panel_input_path, index=False)
        panels = judge_panels_csv(panel_input_path, panel_output_path)
        first_panel = panels.set_index("panel_id").loc["0_0_0"]
        assert first_panel["node_count"] == 3
        assert first_panel["x_mm"] == 10
        assert first_panel["von_mises_mpa"] == 700
        second_panel = panels.set_index("panel_id").loc["1_0_0"]
        assert second_panel["node_count"] == 2
        assert second_panel["von_mises_mpa"] == 400
        print("\nPanel aggregation example (25 mm grid, maximum stress)")
        print(panels.to_string(index=False))
        print("\nPanel judgment example")
        print(judge_panels_csv(
            panel_input_path, panel_output_path,
            defect_sqrt_area_um=100, defect_location="surface",
        ).to_string(index=False))


if __name__ == "__main__":
    _run_example()
