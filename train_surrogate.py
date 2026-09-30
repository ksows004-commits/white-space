"""Run on the GPU server: python train_surrogate.py (outputs beside this file)."""

import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neighbors import NearestNeighbors
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from surrogate_model import StressMLP, build_features

DATA_DIR = Path(__file__).resolve().parent
CASE_FILES = (
    "stress_case1_pressure.csv", "stress_case2_thrust.csv",
    "stress_case3_vibration.csv", "stress_case4_cryo.csv",
)


def load_training_data():
    first = pd.read_csv(DATA_DIR / CASE_FILES[0])
    coords = first[["x_mm", "y_mm", "z_mm"]].to_numpy(dtype=np.float64)
    target = first["von_mises_mpa"].to_numpy(dtype=np.float64)
    for filename in CASE_FILES[1:]:
        case = pd.read_csv(DATA_DIR / filename)
        if not np.array_equal(first["node_id"].to_numpy(), case["node_id"].to_numpy()):
            raise ValueError(f"Node order mismatch: {filename}")
        if not np.array_equal(coords, case[["x_mm", "y_mm", "z_mm"]].to_numpy()):
            raise ValueError(f"Node coordinates mismatch: {filename}")
        target = np.maximum(target, case["von_mises_mpa"].to_numpy(dtype=np.float64))
    if not np.isfinite(coords).all() or not np.isfinite(target).all() or (target < 0).any():
        raise ValueError("CSV coordinates/stresses must be finite; stress must be nonnegative")
    return coords, target


def metrics(actual, predicted):
    return {
        "mae_mpa": float(mean_absolute_error(actual, predicted)),
        "rmse_mpa": float(np.sqrt(mean_squared_error(actual, predicted))),
        "max_abs_error_mpa": float(np.max(np.abs(actual - predicted))),
        "r2": float(r2_score(actual, predicted)),
    }


def main():
    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(42)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    coords, target = load_training_data()
    features = build_features(coords[:, 0], coords[:, 1], coords[:, 2])
    train_idx, val_idx = train_test_split(
        np.arange(len(target)), test_size=0.15, random_state=42
    )
    feature_mean = features[train_idx].mean(axis=0)
    feature_std = features[train_idx].std(axis=0)
    # A constant feature/target uses unit scale to avoid division by zero.
    feature_std = np.where(feature_std == 0, 1.0, feature_std)
    target_mean = float(target[train_idx].mean())
    target_std = float(target[train_idx].std()) or 1.0
    meta = {
        "feature_mean": feature_mean.tolist(), "feature_std": feature_std.tolist(),
        "target_mean": target_mean, "target_std": target_std,
        "input_dim": 5, "hidden_dims": [128, 128, 64],
    }
    inputs = torch.from_numpy(((features - feature_mean) / feature_std).astype(np.float32))
    targets = torch.from_numpy(((target - target_mean) / target_std).astype(np.float32)).unsqueeze(1)
    train_loader = DataLoader(
        TensorDataset(inputs[train_idx], targets[train_idx]), batch_size=4096,
        shuffle=True, generator=torch.Generator().manual_seed(42),
    )
    val_loader = DataLoader(
        TensorDataset(inputs[val_idx], targets[val_idx]), batch_size=4096, shuffle=False,
    )
    model = StressMLP().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-5)
    loss_fn = nn.MSELoss()
    best_loss, stale_epochs = float("inf"), 0
    weights_path = DATA_DIR / "surrogate_model.pt"

    for epoch in range(1, 201):
        model.train()
        for batch_x, batch_y in train_loader:
            batch_x, batch_y = batch_x.to(device), batch_y.to(device)
            optimizer.zero_grad()
            loss = loss_fn(model(batch_x), batch_y)
            loss.backward()
            optimizer.step()
        model.eval()
        val_sum = 0.0
        with torch.inference_mode():
            for batch_x, batch_y in val_loader:
                loss = loss_fn(model(batch_x.to(device)), batch_y.to(device))
                val_sum += loss.item() * len(batch_x)
        val_loss = val_sum / len(val_idx)
        if not np.isfinite(val_loss):
            raise RuntimeError("Non-finite validation loss; no evaluation will be saved")
        print(f"epoch={epoch} val_mse_normalized={val_loss:.8f}", flush=True)
        if val_loss < best_loss:
            best_loss, stale_epochs = val_loss, 0
            torch.save({key: value.detach().cpu() for key, value in model.state_dict().items()}, weights_path)
        else:
            stale_epochs += 1
            if stale_epochs >= 15:
                break

    model.load_state_dict(torch.load(weights_path, map_location=device, weights_only=True))
    model.eval()
    with torch.inference_mode():
        normalized_predictions = np.concatenate([
            model(batch_x.to(device)).cpu().numpy().reshape(-1)
            for batch_x, _ in val_loader
        ])
    predictions = normalized_predictions.astype(np.float64) * target_std + target_mean
    nearest = NearestNeighbors(n_neighbors=1).fit(coords[train_idx])
    indices = nearest.kneighbors(coords[val_idx], return_distance=False).reshape(-1)
    baseline_predictions = target[train_idx][indices]
    evaluation = {
        "train_size": len(train_idx), "val_size": len(val_idx),
        "mlp": metrics(target[val_idx], predictions),
        "nearest_neighbor_baseline": metrics(target[val_idx], baseline_predictions),
    }
    for filename, data in (("surrogate_meta.json", meta), ("surrogate_eval.json", evaluation)):
        with open(DATA_DIR / filename, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
    print(json.dumps(evaluation, ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
