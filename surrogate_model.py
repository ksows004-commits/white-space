"""Shared stress surrogate architecture and preprocessing for training/inference.

Predicts stress for each of the 4 load cases separately (not the envelope max
directly) - the envelope is a non-smooth function of position (it kinks wherever
the dominant case switches), which is harder for a network to fit than each
case's individually smoother field. The exact max is taken after prediction,
not approximated.
"""

import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

FOURIER_FREQS = (1, 2, 4)
BASE_FEATURE_COUNT = 6  # x, y, z, radius, sin(theta), cos(theta)
INPUT_DIM = BASE_FEATURE_COUNT * (1 + 2 * len(FOURIER_FREQS))
CASE_NAMES = ("case1_pressure", "case2_thrust", "case3_vibration", "case4_cryo")


class StressMLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(INPUT_DIM, 128), nn.ReLU(),
            nn.Linear(128, 128), nn.ReLU(),
            nn.Linear(128, 64), nn.ReLU(),
            nn.Linear(64, len(CASE_NAMES)),
        )

    def forward(self, features):
        return self.network(features)


def build_base_features(x_mm, y_mm, z_mm) -> np.ndarray:
    """Accept scalars or arrays. sin/cos(theta) avoid the atan2 wraparound
    discontinuity that raw theta would introduce at +-pi."""
    x, y, z = np.broadcast_arrays(
        np.asarray(x_mm, dtype=np.float64),
        np.asarray(y_mm, dtype=np.float64),
        np.asarray(z_mm, dtype=np.float64),
    )
    radius = np.hypot(x, z)
    theta = np.arctan2(z, x)
    return np.stack((x, y, z, radius, np.sin(theta), np.cos(theta)), axis=-1)


def build_features(x_mm, y_mm, z_mm, feature_mean, feature_std) -> np.ndarray:
    """Base features z-scored, then expanded with Fourier positional encoding
    (mitigates spectral bias - MLPs underfit high-frequency spatial variation
    near sharp features like stress concentrations)."""
    base = build_base_features(x_mm, y_mm, z_mm)
    normalized = (base - feature_mean) / feature_std
    parts = [normalized]
    for k in FOURIER_FREQS:
        parts.append(np.sin(k * normalized))
        parts.append(np.cos(k * normalized))
    return np.concatenate(parts, axis=-1)


def load_surrogate(weights_path: str | Path, meta_path: str | Path):
    with open(meta_path, encoding="utf-8") as handle:
        meta = json.load(handle)
    if (meta["input_dim"] != INPUT_DIM or meta["hidden_dims"] != [128, 128, 64]
            or meta.get("output_dim") != len(CASE_NAMES)):
        raise ValueError("Surrogate metadata does not match StressMLP architecture")
    mean = np.asarray(meta["feature_mean"], dtype=np.float64)
    std = np.asarray(meta["feature_std"], dtype=np.float64)
    if mean.shape != (BASE_FEATURE_COUNT,) or std.shape != (BASE_FEATURE_COUNT,):
        raise ValueError("Expected six base feature means and standard deviations")
    target_mean = np.asarray(meta["target_mean"], dtype=np.float64)
    target_std = np.asarray(meta["target_std"], dtype=np.float64)
    if target_mean.shape != (len(CASE_NAMES),) or target_std.shape != (len(CASE_NAMES),):
        raise ValueError("Expected per-case target means and standard deviations")
    if (not np.isfinite(mean).all() or not np.isfinite(std).all() or (std <= 0).any()
            or not np.isfinite(target_mean).all() or not np.isfinite(target_std).all()
            or (target_std <= 0).any()):
        raise ValueError("Invalid surrogate normalization metadata")
    model = StressMLP()
    model.load_state_dict(torch.load(weights_path, map_location="cpu", weights_only=True))
    model.eval()
    return model, meta


def predict_stress(model, meta, x_mm, y_mm, z_mm) -> float:
    """Predicts envelope (max across the 4 load cases) stress at a point."""
    feature_mean = np.asarray(meta["feature_mean"])
    feature_std = np.asarray(meta["feature_std"])
    features = build_features(x_mm, y_mm, z_mm, feature_mean, feature_std)
    if features.shape != (INPUT_DIM,) or not np.isfinite(features).all():
        raise ValueError("Expected finite scalar coordinates")
    device = next(model.parameters()).device
    inputs = torch.as_tensor(features, dtype=torch.float32, device=device).unsqueeze(0)
    with torch.inference_mode():
        prediction = model(inputs).squeeze(0).cpu().numpy()
    target_mean = np.asarray(meta["target_mean"])
    target_std = np.asarray(meta["target_std"])
    per_case = prediction.astype(np.float64) * target_std + target_mean
    per_case = np.clip(per_case, 0, None)
    return float(per_case.max())
