"""Shared stress surrogate architecture and preprocessing for training/inference."""

import json
from pathlib import Path

import numpy as np
import torch
from torch import nn


class StressMLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(5, 128), nn.ReLU(),
            nn.Linear(128, 128), nn.ReLU(),
            nn.Linear(128, 64), nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, features):
        return self.network(features)


def build_features(x_mm, y_mm, z_mm) -> np.ndarray:
    """Accept scalars or arrays; feature order must match the saved metadata."""
    x, y, z = np.broadcast_arrays(
        np.asarray(x_mm, dtype=np.float64),
        np.asarray(y_mm, dtype=np.float64),
        np.asarray(z_mm, dtype=np.float64),
    )
    return np.stack((x, y, z, np.hypot(x, z), np.arctan2(z, x)), axis=-1)


def load_surrogate(weights_path: str | Path, meta_path: str | Path):
    with open(meta_path, encoding="utf-8") as handle:
        meta = json.load(handle)
    if meta["input_dim"] != 5 or meta["hidden_dims"] != [128, 128, 64]:
        raise ValueError("Surrogate metadata does not match StressMLP architecture")
    mean = np.asarray(meta["feature_mean"], dtype=np.float64)
    std = np.asarray(meta["feature_std"], dtype=np.float64)
    if mean.shape != (5,) or std.shape != (5,):
        raise ValueError("Expected five feature means and standard deviations")
    if (not np.isfinite(mean).all() or not np.isfinite(std).all()
            or (std <= 0).any() or not np.isfinite(meta["target_mean"])
            or not np.isfinite(meta["target_std"]) or meta["target_std"] <= 0):
        raise ValueError("Invalid surrogate normalization metadata")
    model = StressMLP()
    model.load_state_dict(torch.load(weights_path, map_location="cpu", weights_only=True))
    model.eval()
    return model, meta


def predict_stress(model, meta, x_mm, y_mm, z_mm) -> float:
    features = build_features(x_mm, y_mm, z_mm)
    if features.shape != (5,) or not np.isfinite(features).all():
        raise ValueError("Expected finite scalar coordinates")
    normalized = (features - np.asarray(meta["feature_mean"])) / np.asarray(meta["feature_std"])
    device = next(model.parameters()).device
    inputs = torch.as_tensor(normalized, dtype=torch.float32, device=device).unsqueeze(0)
    with torch.inference_mode():
        prediction = model(inputs).item()
    return float(prediction * meta["target_std"] + meta["target_mean"])
