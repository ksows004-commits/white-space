"""Convert a CalculiX .frd result file to the CSV schema used by judge.py/api.py
(node_id, x_mm, y_mm, z_mm, von_mises_mpa).

Usage: python frd_to_csv.py <input.frd> <output.csv>

The .frd format is fixed-width (FORTRAN-style, no guaranteed spaces between
negative numbers). Node coordinates live in the "2C" block; von Mises stress
is derived from the 6-component stress tensor in the "-4  STRESS" block.
Unit system in these files is MM_TON_S_C (mm-ton-s-Celsius), where stress
works out to MPa directly - no conversion needed.
"""

import sys


def parse_nodes(path: str) -> dict[int, tuple[float, float, float]]:
    nodes: dict[int, tuple[float, float, float]] = {}
    in_block = False
    with open(path, "r") as f:
        for line in f:
            if line.startswith("    2C"):
                in_block = True
                continue
            if not in_block:
                continue
            if not line.startswith(" -1"):
                break
            node_id = int(line[3:13])
            x, y, z = (float(line[13 + 12 * i : 25 + 12 * i]) for i in range(3))
            nodes[node_id] = (x, y, z)
    return nodes


def von_mises(sxx: float, syy: float, szz: float, sxy: float, syz: float, szx: float) -> float:
    return (
        0.5
        * (
            (sxx - syy) ** 2
            + (syy - szz) ** 2
            + (szz - sxx) ** 2
            + 6 * (sxy**2 + syz**2 + szx**2)
        )
    ) ** 0.5


def parse_von_mises(path: str) -> dict[int, float]:
    stresses: dict[int, float] = {}
    state = "seek"
    with open(path, "r") as f:
        for line in f:
            if state == "seek":
                if line.startswith(" -4  STRESS"):
                    state = "header"
                continue
            if state == "header":
                if line.startswith(" -5"):
                    continue
                state = "data"
            if state == "data":
                if line.startswith(" -3"):
                    break
                node_id = int(line[3:13])
                vals = tuple(float(line[13 + 12 * i : 25 + 12 * i]) for i in range(6))
                stresses[node_id] = von_mises(*vals)
    return stresses


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: python frd_to_csv.py <input.frd> <output.csv>")
        raise SystemExit(1)

    frd_path, csv_path = sys.argv[1], sys.argv[2]
    nodes = parse_nodes(frd_path)
    stresses = parse_von_mises(frd_path)

    written = 0
    with open(csv_path, "w") as out:
        out.write("node_id,x_mm,y_mm,z_mm,von_mises_mpa\n")
        for node_id, (x, y, z) in nodes.items():
            vm = stresses.get(node_id)
            if vm is None:
                continue
            out.write(f"{node_id},{x},{y},{z},{vm}\n")
            written += 1

    print(f"nodes parsed: {len(nodes)}, stress rows: {len(stresses)}, csv rows written: {written}")


if __name__ == "__main__":
    main()
