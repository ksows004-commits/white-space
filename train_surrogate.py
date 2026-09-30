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

from surrogate_model import (
    BASE_FEATURE_COUNT, CASE_NAMES, FOURIER_FREQS, INPUT_DIM,
    StressMLP, build_base_features, build_features,
)

DATA_DIR = Path(__file__).resolve().parent
CASE_FILES = tuple(f"stress_{name}.csv" for name in CASE_NAMES)


def load_training_data():
    """Returns (coords, targets) where targets is (N, 4) - one column per load
    case, NOT pre-collapsed to an envelope max. The model predicts all 4;
    the envelope is taken exactly after prediction, never approximated."""
    first = pd.read_csv(DATA_DIR / CASE_FILES[0])
    coords = first[["x_mm", "y_mm", "z_mm"]].to_numpy(dtype=np.float64)
    node_ids = first["node_id"].to_numpy()
    targets = np.zeros((len(first), len(CASE_FILES)), dtype=np.float64)
    targets[:, 0] = first["von_mises_mpa"].to_numpy(dtype=np.float64)
    for i, filename in enumerate(CASE_FILES[1:], start=1):
        case = pd.read_csv(DATA_DIR / filename)
        if not np.array_equal(case["node_id"].to_numpy(), node_ids):
            raise ValueError(f"Node order mismatch: {filename}")
        if not np.array_equal(coords, case[["x_mm", "y_mm", "z_mm"]].to_numpy()):
            raise ValueError(f"Node coordinates mismatch: {filename}")
        targets[:, i] = case["von_mises_mpa"].to_numpy(dtype=np.float64)
    if not np.isfinite(coords).all() or not np.isfinite(targets).all():
        raise ValueError("CSV coordinates/stresses must be finite")
    # Compression doesn't drive tensile crack growth under this fatigue model.
    targets = np.clip(targets, 0, None)
    return coords, targets


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

    coords, targets = load_training_data()
    base_features = build_base_features(coords[:, 0], coords[:, 1], coords[:, 2])
    train_idx, val_idx = train_test_split(
        np.arange(len(coords)), test_size=0.15, random_state=42
    )

    feature_mean = base_features[train_idx].mean(axis=0)
    feature_std = base_features[train_idx].std(axis=0)
    feature_std = np.where(feature_std == 0, 1.0, feature_std)

    target_mean = targets[train_idx].mean(axis=0)
    target_std = targets[train_idx].std(axis=0)
    target_std = np.where(target_std == 0, 1.0, target_std)

    meta = {
        "feature_mean": feature_mean.tolist(), "feature_std": feature_std.tolist(),
        "target_mean": target_mean.tolist(), "target_std": target_std.tolist(),
        "input_dim": INPUT_DIM, "hidden_dims": [128, 128, 64],
        "output_dim": len(CASE_NAMES), "fourier_freqs": list(FOURIER_FREQS),
    }
    assert base_features.shape[1] == BASE_FEATURE_COUNT

    all_features = build_features(coords[:, 0], coords[:, 1], coords[:, 2], feature_mean, feature_std)
    inputs = torch.from_numpy(all_features.astype(np.float32))
    normalized_targets = (targets - target_mean) / target_std
    targets_t = torch.from_numpy(normalized_targets.astype(np.float32))

    train_loader = DataLoader(
        TensorDataset(inputs[train_idx], targets_t[train_idx]), batch_size=4096,
        shuffle=True, generator=torch.Generator().manual_seed(42),
    )
    val_loader = DataLoader(
        TensorDataset(inputs[val_idx], targets_t[val_idx]), batch_size=4096, shuffle=False,
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
            model(batch_x.to(device)).cpu().numpy()
            for batch_x, _ in val_loader
        ], axis=0)
    predictions_per_case = normalized_predictions.astype(np.float64) * target_std + target_mean
    predictions_per_case = np.clip(predictions_per_case, 0, None)
    predicted_envelope = predictions_per_case.max(axis=1)
    actual_envelope = targets[val_idx].max(axis=1)

    nearest = NearestNeighbors(n_neighbors=1).fit(coords[train_idx])
    indices = nearest.kneighbors(coords[val_idx], return_distance=False).reshape(-1)
    baseline_envelope = targets[train_idx].max(axis=1)[indices]

    evaluation = {
        "train_size": len(train_idx), "val_size": len(val_idx),
        "mlp": metrics(actual_envelope, predicted_envelope),
        "nearest_neighbor_baseline": metrics(actual_envelope, baseline_envelope),
    }
    for filename, data in (("surrogate_meta.json", meta), ("surrogate_eval.json", evaluation)):
        with open(DATA_DIR / filename, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
    print(json.dumps(evaluation, ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
