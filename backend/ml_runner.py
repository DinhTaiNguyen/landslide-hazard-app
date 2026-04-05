from __future__ import annotations

import copy
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.compose import ColumnTransformer
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from torch.utils.data import DataLoader, TensorDataset

from ml_data_prep import read_asc

LogFn = Callable[[str], None]
POF_BINS = np.array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0000001])
POF_BIN_LABELS = ["0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"]
POF_BIN_COLORS = ["#1a9622", "#8ecf3e", "#f3e64f", "#f6a623", "#e6372e"]
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


@dataclass
class MLConfig:
    stage1_train_events: List[str]
    stage1_test_events: List[str]
    stage1_val_events: List[str]
    stage2_enabled: bool
    stage2_event: Optional[str]
    batch_size_stage1: int
    batch_size_stage2: int
    epochs_stage1: int
    epochs_stage2: int
    lr_stage1: float
    lr_stage2: float
    weight_decay: float
    patience_stage1: int
    patience_stage2: int
    min_delta: float
    stage2_train_frac: float
    stage2_val_frac: float
    stage2_test_frac: float
    class_threshold: float
    random_seed: int = 42


@dataclass
class MLResult:
    summary: Dict[str, object]
    output_files: Dict[str, Path]
    plot_files: Dict[str, Path]


class BaseNet(nn.Module):
    def __init__(self, in_dim: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 128), nn.ReLU(), nn.Dropout(0.10),
            nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.10),
            nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1)
        )

    def forward(self, x):
        return self.net(x)


class ResidualNet(nn.Module):
    def __init__(self, in_dim: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 64), nn.ReLU(), nn.Dropout(0.10),
            nn.Linear(64, 32), nn.ReLU(), nn.Dropout(0.10),
            nn.Linear(32, 1)
        )

    def forward(self, x):
        return self.net(x)


class EarlyStopping:
    def __init__(self, patience=10, min_delta=1e-5):
        self.patience = patience
        self.min_delta = min_delta
        self.best_loss = np.inf
        self.counter = 0
        self.best_state = None
        self.best_epoch = -1

    def step(self, val_loss, model, epoch):
        improved = val_loss < (self.best_loss - self.min_delta)
        if improved:
            self.best_loss = val_loss
            self.counter = 0
            self.best_state = copy.deepcopy(model.state_dict())
            self.best_epoch = epoch
            return True, False
        self.counter += 1
        return False, self.counter >= self.patience


def set_seed(seed=42):
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def make_onehot():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def write_asc(filepath: Path, array2d: np.ndarray, meta: dict):
    with filepath.open("w", encoding="utf-8") as f:
        f.write(f"ncols         {meta['ncols']}\n")
        f.write(f"nrows         {meta['nrows']}\n")
        f.write(f"xllcorner     {meta['xllcorner']}\n")
        f.write(f"yllcorner     {meta['yllcorner']}\n")
        f.write(f"cellsize      {meta['cellsize']}\n")
        f.write(f"NODATA_value  {meta['nodata_value']}\n")
        np.savetxt(f, array2d, fmt="%.6f")


def make_grid_from_values(grid_ids, values, ref_meta, nodata_value=-9999.0):
    grid = np.full(ref_meta["nrows"] * ref_meta["ncols"], nodata_value, dtype=float)
    grid[np.asarray(grid_ids, dtype=int)] = np.asarray(values, dtype=float)
    return grid.reshape((ref_meta["nrows"], ref_meta["ncols"]))


def train_epoch_stage1(model, loader, optimizer, criterion):
    model.train()
    total_loss = total_n = 0
    for xb, yb in loader:
        xb, yb = xb.to(DEVICE), yb.to(DEVICE)
        optimizer.zero_grad()
        logits = model(xb)
        loss = criterion(logits, yb)
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * xb.size(0)
        total_n += xb.size(0)
    return total_loss / max(total_n, 1)


@torch.no_grad()
def eval_epoch_stage1(model, loader, criterion):
    model.eval()
    total_loss = total_n = 0
    preds, targets = [], []
    for xb, yb in loader:
        xb, yb = xb.to(DEVICE), yb.to(DEVICE)
        logits = model(xb)
        loss = criterion(logits, yb)
        total_loss += loss.item() * xb.size(0)
        total_n += xb.size(0)
        preds.append(torch.sigmoid(logits).cpu().numpy())
        targets.append(yb.cpu().numpy())
    preds = np.vstack(preds).ravel() if preds else np.array([])
    targets = np.vstack(targets).ravel() if targets else np.array([])
    return total_loss / max(total_n, 1), preds, targets


@torch.no_grad()
def predict_stage1(model, X):
    model.eval()
    X_t = torch.tensor(X, dtype=torch.float32).to(DEVICE)
    logits = model(X_t)
    probs = torch.sigmoid(logits).cpu().numpy().ravel()
    return logits.cpu().numpy().ravel(), probs


def train_epoch_stage2(base_model, residual_model, loader, optimizer, criterion):
    base_model.eval()
    residual_model.train()
    total_loss = total_n = 0
    for xb_base, xb_res, yb in loader:
        xb_base, xb_res, yb = xb_base.to(DEVICE), xb_res.to(DEVICE), yb.to(DEVICE)
        optimizer.zero_grad()
        with torch.no_grad():
            d1 = base_model(xb_base)
        d2 = residual_model(xb_res)
        final_logits = d1 + d2
        loss = criterion(final_logits, yb)
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * xb_base.size(0)
        total_n += xb_base.size(0)
    return total_loss / max(total_n, 1)


@torch.no_grad()
def eval_epoch_stage2(base_model, residual_model, loader, criterion):
    base_model.eval()
    residual_model.eval()
    total_loss = total_n = 0
    base_probs, final_probs, targets = [], [], []
    for xb_base, xb_res, yb in loader:
        xb_base, xb_res, yb = xb_base.to(DEVICE), xb_res.to(DEVICE), yb.to(DEVICE)
        d1 = base_model(xb_base)
        d2 = residual_model(xb_res)
        final_logits = d1 + d2
        loss = criterion(final_logits, yb)
        total_loss += loss.item() * xb_base.size(0)
        total_n += xb_base.size(0)
        base_probs.append(torch.sigmoid(d1).cpu().numpy())
        final_probs.append(torch.sigmoid(final_logits).cpu().numpy())
        targets.append(yb.cpu().numpy())
    base_probs = np.vstack(base_probs).ravel() if base_probs else np.array([])
    final_probs = np.vstack(final_probs).ravel() if final_probs else np.array([])
    targets = np.vstack(targets).ravel() if targets else np.array([])
    return total_loss / max(total_n, 1), base_probs, final_probs, targets


@torch.no_grad()
def predict_stage2(base_model, residual_model, X_base, X_res):
    base_model.eval()
    residual_model.eval()
    xb = torch.tensor(X_base, dtype=torch.float32).to(DEVICE)
    xr = torch.tensor(X_res, dtype=torch.float32).to(DEVICE)
    d1 = base_model(xb)
    d2 = residual_model(xr)
    return d1.cpu().numpy().ravel(), d2.cpu().numpy().ravel(), torch.sigmoid(d1).cpu().numpy().ravel(), torch.sigmoid(d1 + d2).cpu().numpy().ravel()


def plot_loss(train_losses, val_losses, title, outpath: Path):
    plt.figure(figsize=(8, 5))
    plt.plot(train_losses, label="Train")
    plt.plot(val_losses, label="Validation")
    plt.xlabel("Epoch")
    plt.ylabel("Loss")
    plt.title(title)
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(outpath, dpi=220)
    plt.close()


def plot_message(outpath: Path, title: str, message: str):
    plt.figure(figsize=(7, 4))
    plt.axis("off")
    plt.title(title)
    plt.text(0.5, 0.5, message, ha="center", va="center", wrap=True, fontsize=12)
    plt.tight_layout()
    plt.savefig(outpath, dpi=220)
    plt.close()


def plot_roc_curve(y_true, probs_dict, outpath: Path, title: str):
    plt.figure(figsize=(7, 6))
    for label, prob in probs_dict.items():
        if len(np.unique(y_true)) < 2:
            continue
        fpr, tpr, _ = roc_curve(y_true, prob)
        auc = roc_auc_score(y_true, prob)
        plt.plot(fpr, tpr, label=f"{label} (AUC={auc:.3f})")
    plt.plot([0, 1], [0, 1], "--", color="gray")
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.title(title)
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(outpath, dpi=220)
    plt.close()


def compute_pof_proportions(prob_array):
    counts, _ = np.histogram(prob_array, bins=POF_BINS)
    return counts / counts.sum() if counts.sum() > 0 else np.zeros(len(counts), dtype=float)


def draw_combined_donut_panel(donut_records, outpath: Path):
    n = max(len(donut_records), 1)
    cols = 2
    rows = int(math.ceil(n / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(14, 7 * rows), subplot_kw=dict(aspect="equal"))
    axes = np.array(axes).reshape(-1)
    for ax in axes[n:]:
        ax.axis("off")
    for ax, record in zip(axes, donut_records):
        event_id = record["event_id"]
        ring_data = record["rings"]
        radii = [1.0, 0.78, 0.56]
        for radius, (_, props) in zip(radii, ring_data):
            ax.pie(props, radius=radius, colors=POF_BIN_COLORS, startangle=90, counterclock=False,
                   wedgeprops=dict(width=0.18, edgecolor="white", linewidth=2))
        ax.text(0, 0.05, "PoF", ha="center", va="center", fontsize=14, weight="bold")
        ax.text(0, -0.12, event_id, ha="center", va="center", fontsize=11)
        labels_text = " | ".join([name for name, _ in ring_data])
        ax.set_title(labels_text, fontsize=10)
    handles = [plt.Line2D([0], [0], color=c, lw=10) for c in POF_BIN_COLORS]
    fig.legend(handles, POF_BIN_LABELS, loc="lower center", ncol=5, frameon=False, bbox_to_anchor=(0.5, 0.02))
    fig.suptitle("PoF category proportion comparison", fontsize=16)
    plt.tight_layout(rect=[0, 0.06, 1, 0.95])
    plt.savefig(outpath, dpi=220)
    plt.close()


def stratified_split_single_event(df, label_col, train_frac, val_frac, test_frac, seed=42):
    assert abs(train_frac + val_frac + test_frac - 1.0) < 1e-9
    pos = df[df[label_col] == 1].copy()
    neg = df[df[label_col] == 0].copy()
    rng = np.random.default_rng(seed)
    pos_idx = np.arange(len(pos)); neg_idx = np.arange(len(neg))
    rng.shuffle(pos_idx); rng.shuffle(neg_idx)

    def split_idx(idx):
        n = len(idx)
        n_train = int(round(train_frac * n))
        n_val = int(round(val_frac * n))
        return idx[:n_train], idx[n_train:n_train+n_val], idx[n_train+n_val:]

    pos_train, pos_val, pos_test = split_idx(pos_idx)
    neg_train, neg_val, neg_test = split_idx(neg_idx)
    train_df = pd.concat([pos.iloc[pos_train], neg.iloc[neg_train]], ignore_index=True).sample(frac=1, random_state=seed)
    val_df = pd.concat([pos.iloc[pos_val], neg.iloc[neg_val]], ignore_index=True).sample(frac=1, random_state=seed)
    test_df = pd.concat([pos.iloc[pos_test], neg.iloc[neg_test]], ignore_index=True).sample(frac=1, random_state=seed)
    return train_df, val_df, test_df


def run_ml_pipeline(
    dataset_csv: Path,
    reference_asc: Path,
    config: MLConfig,
    output_dir: Path,
    label_asc: Optional[Path],
    log: LogFn,
) -> MLResult:
    set_seed(config.random_seed)
    output_dir.mkdir(parents=True, exist_ok=True)
    map_dir = output_dir / "prediction_maps"; map_dir.mkdir(exist_ok=True)
    plot_dir = output_dir / "plots"; plot_dir.mkdir(exist_ok=True)
    model_dir = output_dir / "models"; model_dir.mkdir(exist_ok=True)

    log(f"Loading stage1 dataset from {dataset_csv.name}")
    df = pd.read_csv(dataset_csv)
    df["event_id"] = df["event_id"].astype(str)
    if "geology" in df.columns:
        df["geology"] = df["geology"].astype(str)
    if "landcover_class" in df.columns:
        df["landcover_class"] = df["landcover_class"].astype(str)

    all_events = sorted(df["event_id"].unique().tolist())
    train_events = config.stage1_train_events or [e for e in all_events if e not in config.stage1_test_events and e not in config.stage1_val_events]
    train_events = [e for e in train_events if e in all_events]
    train_df = df[df["event_id"].isin(train_events)].copy()
    val_df = df[df["event_id"].isin(config.stage1_val_events)].copy()
    test_df = df[df["event_id"].isin(config.stage1_test_events)].copy()
    if len(train_df) == 0:
        raise ValueError("No training rows remain after selecting validation and test events.")
    if len(val_df) == 0:
        raise ValueError("No validation rows found for selected validation events.")
    if len(test_df) == 0:
        raise ValueError("No testing rows found for selected test events.")
    log(f"Stage 1 splits | train events: {train_events} | val events: {config.stage1_val_events} | test events: {config.stage1_test_events}")

    exclude = {"grid_id", "event_id", "pof_form", "label", "base_logit"}
    cat_features = [c for c in ["geology", "landcover_class"] if c in df.columns]
    num_features = [c for c in df.columns if c not in exclude and c not in cat_features]

    stage1_preprocessor = ColumnTransformer(
        transformers=[("num", StandardScaler(), num_features)] + ([ ("cat", make_onehot(), cat_features) ] if cat_features else []),
        remainder="drop",
    )
    X_train = stage1_preprocessor.fit_transform(train_df).astype(np.float32)
    X_val = stage1_preprocessor.transform(val_df).astype(np.float32)
    X_test = stage1_preprocessor.transform(test_df).astype(np.float32)
    y_train = train_df["pof_form"].values.astype(np.float32).reshape(-1, 1)
    y_val = val_df["pof_form"].values.astype(np.float32).reshape(-1, 1)
    y_test = test_df["pof_form"].values.astype(np.float32).reshape(-1, 1)

    train_loader = DataLoader(TensorDataset(torch.tensor(X_train), torch.tensor(y_train)), batch_size=config.batch_size_stage1, shuffle=True)
    val_loader = DataLoader(TensorDataset(torch.tensor(X_val), torch.tensor(y_val)), batch_size=config.batch_size_stage1, shuffle=False)
    test_loader = DataLoader(TensorDataset(torch.tensor(X_test), torch.tensor(y_test)), batch_size=config.batch_size_stage1, shuffle=False)

    base_model = BaseNet(X_train.shape[1]).to(DEVICE)
    optimizer1 = torch.optim.Adam(base_model.parameters(), lr=config.lr_stage1, weight_decay=config.weight_decay)
    criterion1 = nn.BCEWithLogitsLoss()
    stopper1 = EarlyStopping(config.patience_stage1, config.min_delta)
    train_losses_s1, val_losses_s1 = [], []
    log(f"Training Stage 1 on {len(train_df):,} rows using {X_train.shape[1]} input features")
    for epoch in range(config.epochs_stage1):
        train_loss = train_epoch_stage1(base_model, train_loader, optimizer1, criterion1)
        val_loss, _, _ = eval_epoch_stage1(base_model, val_loader, criterion1)
        train_losses_s1.append(train_loss); val_losses_s1.append(val_loss)
        improved, stop = stopper1.step(val_loss, base_model, epoch)
        log(f"Stage 1 epoch {epoch+1}/{config.epochs_stage1} | train={train_loss:.6f} | val={val_loss:.6f}{' | best' if improved else ''}")
        if stop:
            log(f"Stage 1 early stopping at epoch {epoch+1}")
            break
    base_model.load_state_dict(stopper1.best_state)
    torch.save(base_model.state_dict(), model_dir / "best_stage1_model.pt")
    stage1_loss_png = plot_dir / "stage1_loss.png"
    plot_loss(train_losses_s1, val_losses_s1, "Stage 1 Loss", stage1_loss_png)

    _, s1_test_pred, s1_test_true = eval_epoch_stage1(base_model, test_loader, criterion1)
    stage1_mae = float(np.mean(np.abs(s1_test_pred - s1_test_true)))

    stage2_loss_png = plot_dir / "stage2_loss.png"
    roc_png = plot_dir / "roc_curve.png"
    donut_png = plot_dir / "pof_proportion_donut_panel.png"
    prediction_csv = output_dir / "predictions_stage1.csv"
    metrics_txt = output_dir / "metrics_summary.txt"

    plot_files = {"stage1_loss.png": stage1_loss_png}
    output_files: Dict[str, Path] = {prediction_csv.name: prediction_csv, metrics_txt.name: metrics_txt}

    ref_arr, ref_meta = read_asc(reference_asc)
    output_meta = ref_meta.copy(); output_meta["nodata_value"] = -9999.0
    donut_records = []

    stage2_summary = {}
    stage2_enabled_and_ready = config.stage2_enabled and bool(config.stage2_event) and label_asc is not None
    residual_model = None
    stage2_preprocessor = None

    if stage2_enabled_and_ready:
        label_arr, label_meta = read_asc(label_asc)
        label_flat = label_arr.ravel(); label_nodata = label_meta["nodata_value"]
        s2_df = df[df["event_id"] == str(config.stage2_event)].copy()
        if len(s2_df) == 0:
            raise ValueError(f"Stage 2 event {config.stage2_event} not found in dataset.")
        s2_df["label"] = label_flat[s2_df["grid_id"].values]
        s2_df = s2_df[s2_df["label"] != label_nodata].copy()
        s2_df["label"] = s2_df["label"].astype(int)
        if s2_df["label"].nunique() < 2:
            raise ValueError("Stage 2 label map does not contain at least two classes after masking nodata.")
        X_full_base = stage1_preprocessor.transform(s2_df).astype(np.float32)
        d1_full, base_prob_full = predict_stage1(base_model, X_full_base)
        s2_df["base_logit"] = d1_full
        s2_train_df, s2_val_df, s2_test_df = stratified_split_single_event(s2_df, "label", config.stage2_train_frac, config.stage2_val_frac, config.stage2_test_frac, seed=config.random_seed)

        s2_cat_features = cat_features[:]
        s2_num_features = [c for c in s2_df.columns if c not in {"grid_id", "event_id", "pof_form", "label"} and c not in s2_cat_features]
        stage2_preprocessor = ColumnTransformer(
            transformers=[("num", StandardScaler(), s2_num_features)] + ([ ("cat", make_onehot(), s2_cat_features) ] if s2_cat_features else []),
            remainder="drop",
        )
        X_train_base = stage1_preprocessor.transform(s2_train_df).astype(np.float32)
        X_val_base = stage1_preprocessor.transform(s2_val_df).astype(np.float32)
        X_test_base = stage1_preprocessor.transform(s2_test_df).astype(np.float32)
        X_train_res = stage2_preprocessor.fit_transform(s2_train_df).astype(np.float32)
        X_val_res = stage2_preprocessor.transform(s2_val_df).astype(np.float32)
        X_test_res = stage2_preprocessor.transform(s2_test_df).astype(np.float32)
        y_train_s2 = s2_train_df["label"].values.astype(np.float32).reshape(-1, 1)
        y_val_s2 = s2_val_df["label"].values.astype(np.float32).reshape(-1, 1)
        y_test_s2 = s2_test_df["label"].values.astype(np.float32).reshape(-1, 1)
        train_loader_s2 = DataLoader(TensorDataset(torch.tensor(X_train_base), torch.tensor(X_train_res), torch.tensor(y_train_s2)), batch_size=config.batch_size_stage2, shuffle=True)
        val_loader_s2 = DataLoader(TensorDataset(torch.tensor(X_val_base), torch.tensor(X_val_res), torch.tensor(y_val_s2)), batch_size=config.batch_size_stage2, shuffle=False)
        test_loader_s2 = DataLoader(TensorDataset(torch.tensor(X_test_base), torch.tensor(X_test_res), torch.tensor(y_test_s2)), batch_size=config.batch_size_stage2, shuffle=False)
        for p in base_model.parameters():
            p.requires_grad = False
        n_pos = float(np.sum(y_train_s2)); n_neg = float(len(y_train_s2) - n_pos)
        pos_weight = n_neg / n_pos if n_pos > 0 else 1.0
        residual_model = ResidualNet(X_train_res.shape[1]).to(DEVICE)
        optimizer2 = torch.optim.Adam(residual_model.parameters(), lr=config.lr_stage2, weight_decay=config.weight_decay)
        criterion2 = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([pos_weight], dtype=torch.float32).to(DEVICE))
        stopper2 = EarlyStopping(config.patience_stage2, config.min_delta)
        train_losses_s2, val_losses_s2 = [], []
        log(f"Training Stage 2 on event {config.stage2_event} with {len(s2_train_df):,} train rows")
        for epoch in range(config.epochs_stage2):
            train_loss = train_epoch_stage2(base_model, residual_model, train_loader_s2, optimizer2, criterion2)
            val_loss, _, _, _ = eval_epoch_stage2(base_model, residual_model, val_loader_s2, criterion2)
            train_losses_s2.append(train_loss); val_losses_s2.append(val_loss)
            improved, stop = stopper2.step(val_loss, residual_model, epoch)
            log(f"Stage 2 epoch {epoch+1}/{config.epochs_stage2} | train={train_loss:.6f} | val={val_loss:.6f}{' | best' if improved else ''}")
            if stop:
                log(f"Stage 2 early stopping at epoch {epoch+1}")
                break
        residual_model.load_state_dict(stopper2.best_state)
        torch.save(residual_model.state_dict(), model_dir / "best_stage2_model.pt")
        plot_loss(train_losses_s2, val_losses_s2, "Stage 2 Loss", stage2_loss_png)
        plot_files[stage2_loss_png.name] = stage2_loss_png
        s2_test_loss, s2_test_base_prob, s2_test_final_prob, s2_test_true = eval_epoch_stage2(base_model, residual_model, test_loader_s2, criterion2)
        geotop_test_prob = s2_test_df["pof_form"].values.astype(float)
        plot_roc_curve(s2_test_true, {"GeoTOP-FORM": geotop_test_prob, "Stage 1": s2_test_base_prob, "Stage 2": s2_test_final_prob}, roc_png, f"ROC on {config.stage2_event}")
        plot_files[roc_png.name] = roc_png
        stage2_summary = {
            "stage2_event": config.stage2_event,
            "stage2_test_rows": int(len(s2_test_df)),
            "stage2_test_bce": float(s2_test_loss),
            "stage2_roc_auc": float(roc_auc_score(s2_test_true, s2_test_final_prob)),
        }
        log(f"Stage 2 completed with ROC AUC = {stage2_summary['stage2_roc_auc']:.4f}")
    else:
        plot_message(stage2_loss_png, "Stage 2 not active", "Stage 2 training was disabled or label input was not provided.")
        plot_message(roc_png, "ROC not available", "ROC requires an active Stage 2 event with landslide_label.asc.")
        plot_files[stage2_loss_png.name] = stage2_loss_png
        plot_files[roc_png.name] = roc_png

    metrics_lines = []
    prediction_rows = []
    for event_id in config.stage1_test_events:
        event_df = df[df["event_id"] == event_id].copy()
        if len(event_df) == 0:
            continue
        X_event_base = stage1_preprocessor.transform(event_df).astype(np.float32)
        base_logits, stage1_prob = predict_stage1(base_model, X_event_base)
        event_df["stage1_base_prob"] = stage1_prob
        event_df["stage1_base_logit"] = base_logits
        geotop_prob = event_df["pof_form"].values.astype(float)
        ring_data = [("GeoTOP-FORM", compute_pof_proportions(geotop_prob)), ("Stage 1", compute_pof_proportions(stage1_prob))]

        geotop_grid = make_grid_from_values(event_df["grid_id"].values, geotop_prob, output_meta)
        stage1_grid = make_grid_from_values(event_df["grid_id"].values, stage1_prob, output_meta)
        geotop_out = map_dir / f"geotop_form_pof_{event_id}.asc"
        stage1_out = map_dir / f"stage1_base_prob_{event_id}.asc"
        write_asc(geotop_out, geotop_grid, output_meta)
        write_asc(stage1_out, stage1_grid, output_meta)
        output_files[geotop_out.name] = geotop_out
        output_files[stage1_out.name] = stage1_out
        metrics_lines.append(f"Event {event_id}: Stage 1 mean prob={float(np.mean(stage1_prob)):.4f}")

        if residual_model is not None and stage2_preprocessor is not None:
            event_df["base_logit"] = base_logits
            X_event_res = stage2_preprocessor.transform(event_df).astype(np.float32)
            _, _, _, stage2_prob = predict_stage2(base_model, residual_model, X_event_base, X_event_res)
            event_df["stage2_final_prob"] = stage2_prob
            stage2_grid = make_grid_from_values(event_df["grid_id"].values, stage2_prob, output_meta)
            stage2_out = map_dir / f"stage2_final_prob_{event_id}.asc"
            write_asc(stage2_out, stage2_grid, output_meta)
            output_files[stage2_out.name] = stage2_out
            ring_data.append(("Stage 2", compute_pof_proportions(stage2_prob)))
            metrics_lines.append(f"Event {event_id}: Stage 2 mean prob={float(np.mean(stage2_prob)):.4f}")

        prediction_rows.append(event_df)
        donut_records.append({"event_id": event_id, "rings": ring_data})

    if prediction_rows:
        pd.concat(prediction_rows, ignore_index=True).to_csv(prediction_csv, index=False)
    else:
        pd.DataFrame().to_csv(prediction_csv, index=False)

    draw_combined_donut_panel(donut_records, donut_png)
    plot_files[donut_png.name] = donut_png
    output_files[prediction_csv.name] = prediction_csv

    with metrics_txt.open("w", encoding="utf-8") as f:
        f.write("Machine learning summary\n")
        f.write("=" * 60 + "\n")
        f.write(f"Device: {DEVICE}\n")
        f.write(f"Train events: {train_events}\n")
        f.write(f"Val events: {config.stage1_val_events}\n")
        f.write(f"Test events: {config.stage1_test_events}\n")
        f.write(f"Stage 1 MAE (soft labels on test): {stage1_mae:.6f}\n")
        for line in metrics_lines:
            f.write(line + "\n")
        if stage2_summary:
            f.write(json.dumps(stage2_summary, indent=2) + "\n")
        else:
            f.write("Stage 2 was disabled or not configured.\n")
    output_files[metrics_txt.name] = metrics_txt

    summary = {
        "device": DEVICE,
        "stage1_train_events": train_events,
        "stage1_val_events": config.stage1_val_events,
        "stage1_test_events": config.stage1_test_events,
        "stage1_feature_count": len(num_features) + len(cat_features),
        "stage1_softlabel_mae": stage1_mae,
        "stage2_enabled": bool(stage2_enabled_and_ready),
        **stage2_summary,
    }
    return MLResult(summary=summary, output_files=output_files, plot_files=plot_files)
