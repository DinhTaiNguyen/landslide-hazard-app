from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional
import pickle

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.metrics import mean_absolute_error, roc_auc_score, roc_curve
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from ml_data_prep import read_asc

LogFn = Callable[[str], None]
POF_BINS = np.array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0000001])
POF_BIN_LABELS = ["0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"]
POF_BIN_COLORS = ["#1a9622", "#8ecf3e", "#f3e64f", "#f6a623", "#e6372e"]


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


def set_seed(seed: int = 42):
    np.random.seed(seed)


def make_onehot():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=True)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=True)


def write_asc(filepath: Path, array2d: np.ndarray, meta: dict):
    with filepath.open("w", encoding="utf-8") as f:
        f.write(f"ncols         {meta['ncols']}\n")
        f.write(f"nrows         {meta['nrows']}\n")
        f.write(f"xllcorner     {meta['xllcorner']}\n")
        f.write(f"yllcorner     {meta['yllcorner']}\n")
        f.write(f"cellsize      {meta['cellsize']}\n")
        f.write(f"NODATA_value  {meta['nodata_value']}\n")
        np.savetxt(f, array2d, fmt="%.6f")


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
        ax.set_title(" | ".join(name for name, _ in ring_data), fontsize=10)
    handles = [plt.Line2D([0], [0], color=c, lw=10) for c in POF_BIN_COLORS]
    fig.legend(handles, POF_BIN_LABELS, loc="lower center", ncol=5, frameon=False, bbox_to_anchor=(0.5, 0.02))
    fig.suptitle("PoF category proportion comparison", fontsize=16)
    plt.tight_layout(rect=[0, 0.06, 1, 0.95])
    plt.savefig(outpath, dpi=220)
    plt.close()


def plot_loss(train_losses, val_losses, title, outpath: Path):
    plt.figure(figsize=(8, 5))
    plt.plot(train_losses, label="Train")
    plt.plot(val_losses, label="Validation")
    plt.xlabel("Epoch")
    plt.ylabel("MAE")
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


def infer_csv_dtypes(csv_path: Path) -> dict:
    header = pd.read_csv(csv_path, nrows=0)
    dtypes = {}
    for col in header.columns:
        if col == "grid_id":
            dtypes[col] = np.int32
        elif col in {"soiltype_code", "landcover_code", "label"}:
            dtypes[col] = np.int16
        elif col in {"event_id", "geology", "landcover_class"}:
            dtypes[col] = "string"
        else:
            dtypes[col] = np.float32
    return dtypes


def sample_rows_for_events(csv_path: Path, event_ids: List[str], dtypes: dict, max_rows: int, seed: int, log: LogFn, label: str, chunksize: int = 10000) -> pd.DataFrame:
    if not event_ids:
        return pd.DataFrame()
    rng = np.random.default_rng(seed)
    wanted = set(str(e) for e in event_ids)
    reservoir = None
    seen = 0
    for chunk in pd.read_csv(csv_path, dtype=dtypes, chunksize=chunksize):
        chunk["event_id"] = chunk["event_id"].astype(str)
        filt = chunk[chunk["event_id"].isin(wanted)]
        if filt.empty:
            continue
        reservoir = filt.copy() if reservoir is None else pd.concat([reservoir, filt], ignore_index=True)
        seen += len(filt)
        if len(reservoir) > max_rows:
            take_idx = rng.choice(len(reservoir), size=max_rows, replace=False)
            reservoir = reservoir.iloc[take_idx].reset_index(drop=True)
    if reservoir is None:
        reservoir = pd.DataFrame()
    else:
        reservoir = reservoir.reset_index(drop=True)
    log(f"{label}: kept {len(reservoir):,} sampled rows from {seen:,} available rows")
    return reservoir


def chunk_reader_for_events(csv_path: Path, event_ids: List[str], dtypes: dict, chunksize: int = 10000):
    wanted = set(str(e) for e in event_ids)
    for chunk in pd.read_csv(csv_path, dtype=dtypes, chunksize=chunksize):
        chunk["event_id"] = chunk["event_id"].astype(str)
        filt = chunk[chunk["event_id"].isin(wanted)]
        if not filt.empty:
            yield filt.reset_index(drop=True)


def stratified_split_single_event(df, label_col, train_frac, val_frac, test_frac, seed=42):
    assert abs(train_frac + val_frac + test_frac - 1.0) < 1e-9
    pos = df[df[label_col] == 1].copy()
    neg = df[df[label_col] == 0].copy()
    rng = np.random.default_rng(seed)
    pos_idx = np.arange(len(pos))
    neg_idx = np.arange(len(neg))
    rng.shuffle(pos_idx)
    rng.shuffle(neg_idx)

    def split_idx(idx):
        n = len(idx)
        n_train = int(round(train_frac * n))
        n_val = int(round(val_frac * n))
        return idx[:n_train], idx[n_train:n_train + n_val], idx[n_train + n_val:]

    pos_train, pos_val, pos_test = split_idx(pos_idx)
    neg_train, neg_val, neg_test = split_idx(neg_idx)
    train_df = pd.concat([pos.iloc[pos_train], neg.iloc[neg_train]], ignore_index=True).sample(frac=1, random_state=seed)
    val_df = pd.concat([pos.iloc[pos_val], neg.iloc[neg_val]], ignore_index=True).sample(frac=1, random_state=seed)
    test_df = pd.concat([pos.iloc[pos_test], neg.iloc[neg_test]], ignore_index=True).sample(frac=1, random_state=seed)
    return train_df, val_df, test_df


def build_stage1_preprocessor(header_cols: List[str]):
    exclude = {"grid_id", "event_id", "pof_form", "label", "base_logit"}
    cat_features = [c for c in ["geology", "landcover_class"] if c in header_cols]
    num_features = [c for c in header_cols if c not in exclude and c not in cat_features]
    preprocessor = ColumnTransformer(
        transformers=[("num", StandardScaler(), num_features)] + ([('cat', make_onehot(), cat_features)] if cat_features else []),
        remainder='drop',
        sparse_threshold=0.3,
    )
    return preprocessor, num_features, cat_features


def build_stage2_preprocessor(df: pd.DataFrame, cat_features: List[str]):
    exclude = {"grid_id", "event_id", "pof_form", "label"}
    stage2_cat = [c for c in cat_features if c in df.columns]
    stage2_num = [c for c in df.columns if c not in exclude and c not in stage2_cat]
    preprocessor = ColumnTransformer(
        transformers=[("num", StandardScaler(), stage2_num)] + ([('cat', make_onehot(), stage2_cat)] if stage2_cat else []),
        remainder='drop',
        sparse_threshold=0.3,
    )
    return preprocessor, stage2_num, stage2_cat


def run_stage1(train_df, val_df, test_df, preprocessor, config: MLConfig, log: LogFn, plot_dir: Path, model_dir: Path):
    X_train = preprocessor.fit_transform(train_df)
    X_val = preprocessor.transform(val_df)
    X_test = preprocessor.transform(test_df)
    if hasattr(X_train, 'toarray'): X_train = X_train.toarray().astype(np.float32, copy=False)
    if hasattr(X_val, 'toarray'): X_val = X_val.toarray().astype(np.float32, copy=False)
    if hasattr(X_test, 'toarray'): X_test = X_test.toarray().astype(np.float32, copy=False)
    y_train = train_df['pof_form'].astype(np.float32).values
    y_val = val_df['pof_form'].astype(np.float32).values
    y_test = test_df['pof_form'].astype(np.float32).values

    model = MLPRegressor(
        hidden_layer_sizes=(128, 64, 32),
        activation='relu',
        solver='adam',
        alpha=max(config.weight_decay, 1e-6),
        batch_size=min(max(int(config.batch_size_stage1), 64), 256),
        learning_rate_init=max(config.lr_stage1, 1e-4),
        max_iter=1,
        warm_start=True,
        random_state=config.random_seed,
        shuffle=True,
    )
    best_model = None
    best_val = np.inf
    patience = 0
    train_losses = []
    val_losses = []
    n_epochs = max(10, min(int(config.epochs_stage1), 40))
    for epoch in range(n_epochs):
        model.fit(X_train, y_train)
        train_pred = np.clip(model.predict(X_train).astype(np.float32), 0.0, 1.0)
        val_pred = np.clip(model.predict(X_val).astype(np.float32), 0.0, 1.0)
        train_mae = float(mean_absolute_error(y_train, train_pred))
        val_mae = float(mean_absolute_error(y_val, val_pred))
        train_losses.append(train_mae)
        val_losses.append(val_mae)
        improved = val_mae < (best_val - config.min_delta)
        if improved:
            best_val = val_mae
            patience = 0
            best_model = pickle.dumps(model)
        else:
            patience += 1
        log(f"Stage 1 epoch {epoch + 1} | train_mae={train_mae:.6f} | val_mae={val_mae:.6f}{' | best' if improved else ''}")
        if patience >= min(int(config.patience_stage1), 8):
            log(f"Stage 1 early stopping at epoch {epoch + 1}")
            break
    if best_model is not None:
        model = pickle.loads(best_model)
    test_pred = np.clip(model.predict(X_test).astype(np.float32), 0.0, 1.0)
    stage1_loss_png = plot_dir / 'stage1_loss.png'
    plot_loss(train_losses, val_losses, 'Stage 1 Loss', stage1_loss_png)
    with open(model_dir / 'best_stage1_model.pkl', 'wb') as f:
        pickle.dump(model, f)
    return model, test_pred, y_test, stage1_loss_png, float(mean_absolute_error(y_test, test_pred))


def run_stage2(dataset_csv: Path, dtypes: dict, stage1_preprocessor, stage1_model, cat_features, config: MLConfig, label_asc: Path, log: LogFn, plot_dir: Path, model_dir: Path):
    label_arr, label_meta = read_asc(label_asc)
    label_flat = label_arr.ravel()
    label_nodata = label_meta['nodata_value']
    s2_df = sample_rows_for_events(dataset_csv, [str(config.stage2_event)], dtypes, max_rows=10000, seed=config.random_seed + 3, log=log, label=f"Stage 2 event {config.stage2_event}")
    if s2_df.empty:
        raise ValueError(f"Stage 2 event {config.stage2_event} not found in dataset.")
    s2_df['label'] = label_flat[s2_df['grid_id'].astype(np.int64).values]
    s2_df = s2_df[s2_df['label'] != label_nodata].copy()
    s2_df['label'] = s2_df['label'].astype(np.int16)
    if s2_df['label'].nunique() < 2:
        raise ValueError('Stage 2 label map does not contain at least two classes after masking nodata.')

    X_stage1 = stage1_preprocessor.transform(s2_df)
    if hasattr(X_stage1, 'toarray'): X_stage1 = X_stage1.toarray().astype(np.float32, copy=False)
    s2_df['base_logit'] = stage1_model.predict(X_stage1).astype(np.float32)
    s2_train_df, s2_val_df, s2_test_df = stratified_split_single_event(s2_df, 'label', config.stage2_train_frac, config.stage2_val_frac, config.stage2_test_frac, seed=config.random_seed)
    preprocessor2, stage2_num, stage2_cat = build_stage2_preprocessor(s2_df, cat_features)
    X_train = preprocessor2.fit_transform(s2_train_df)
    X_val = preprocessor2.transform(s2_val_df)
    X_test = preprocessor2.transform(s2_test_df)
    if hasattr(X_train, 'toarray'): X_train = X_train.toarray().astype(np.float32, copy=False)
    if hasattr(X_val, 'toarray'): X_val = X_val.toarray().astype(np.float32, copy=False)
    if hasattr(X_test, 'toarray'): X_test = X_test.toarray().astype(np.float32, copy=False)
    y_train = s2_train_df['label'].astype(np.int8).values
    y_val = s2_val_df['label'].astype(np.int8).values
    y_test = s2_test_df['label'].astype(np.int8).values

    model = MLPClassifier(
        hidden_layer_sizes=(64, 32),
        activation='relu',
        solver='adam',
        alpha=max(config.weight_decay, 1e-6),
        batch_size=min(max(int(config.batch_size_stage2), 32), 128),
        learning_rate_init=max(config.lr_stage2, 1e-4),
        max_iter=1,
        warm_start=True,
        random_state=config.random_seed,
        shuffle=True,
    )
    best_model = None
    best_val = np.inf
    patience = 0
    train_losses = []
    val_losses = []
    n_epochs = max(10, min(int(config.epochs_stage2), 40))
    for epoch in range(n_epochs):
        model.fit(X_train, y_train)
        train_prob = model.predict_proba(X_train)[:, 1].astype(np.float32)
        val_prob = model.predict_proba(X_val)[:, 1].astype(np.float32)
        train_mae = float(mean_absolute_error(y_train, train_prob))
        val_mae = float(mean_absolute_error(y_val, val_prob))
        train_losses.append(train_mae)
        val_losses.append(val_mae)
        improved = val_mae < (best_val - config.min_delta)
        if improved:
            best_val = val_mae
            patience = 0
            best_model = pickle.dumps(model)
        else:
            patience += 1
        log(f"Stage 2 epoch {epoch + 1} | train_mae={train_mae:.6f} | val_mae={val_mae:.6f}{' | best' if improved else ''}")
        if patience >= min(int(config.patience_stage2), 8):
            log(f"Stage 2 early stopping at epoch {epoch + 1}")
            break
    if best_model is not None:
        model = pickle.loads(best_model)
    test_prob = model.predict_proba(X_test)[:, 1].astype(np.float32)
    geotop_prob = s2_test_df['pof_form'].astype(float).values
    X_test_stage1 = stage1_preprocessor.transform(s2_test_df)
    if hasattr(X_test_stage1, 'toarray'): X_test_stage1 = X_test_stage1.toarray().astype(np.float32, copy=False)
    stage1_prob = np.clip(stage1_model.predict(X_test_stage1), 0.0, 1.0)
    roc_png = plot_dir / 'roc_curve.png'
    plot_roc_curve(y_test, {'GeoTOP-FORM': geotop_prob, 'Stage 1': stage1_prob[:len(y_test)], 'Stage 2': test_prob}, roc_png, f'ROC on {config.stage2_event}')
    stage2_loss_png = plot_dir / 'stage2_loss.png'
    plot_loss(train_losses, val_losses, 'Stage 2 Loss', stage2_loss_png)
    with open(model_dir / 'best_stage2_model.pkl', 'wb') as f:
        pickle.dump(model, f)
    summary = {
        'stage2_event': config.stage2_event,
        'stage2_test_rows': int(len(s2_test_df)),
        'stage2_roc_auc': float(roc_auc_score(y_test, test_prob)) if len(np.unique(y_test)) > 1 else None,
    }
    return model, preprocessor2, stage2_loss_png, roc_png, summary


def run_ml_pipeline(dataset_csv: Path, reference_asc: Path, config: MLConfig, output_dir: Path, label_asc: Optional[Path], log: LogFn) -> MLResult:
    set_seed(config.random_seed)
    output_dir.mkdir(parents=True, exist_ok=True)
    map_dir = output_dir / 'prediction_maps'
    plot_dir = output_dir / 'plots'
    model_dir = output_dir / 'models'
    map_dir.mkdir(exist_ok=True)
    plot_dir.mkdir(exist_ok=True)
    model_dir.mkdir(exist_ok=True)

    dtypes = infer_csv_dtypes(dataset_csv)
    header_cols = pd.read_csv(dataset_csv, nrows=0).columns.tolist()
    all_events = sorted(pd.read_csv(dataset_csv, usecols=['event_id'], dtype={'event_id': 'string'})['event_id'].astype(str).unique().tolist())
    train_events = [e for e in config.stage1_train_events if e in all_events]
    val_events = [e for e in config.stage1_val_events if e in all_events]
    test_events = [e for e in config.stage1_test_events if e in all_events]
    if not train_events or not val_events or not test_events:
        raise ValueError('Training, validation, and testing event selections must all contain at least one valid event.')

    log(f'Loading machine learning dataset from {dataset_csv.name} using memory-optimised original-like neural-network mode')
    train_df = sample_rows_for_events(dataset_csv, train_events, dtypes, max_rows=8000, seed=config.random_seed, log=log, label='Stage 1 training')
    val_df = sample_rows_for_events(dataset_csv, val_events, dtypes, max_rows=4000, seed=config.random_seed + 1, log=log, label='Stage 1 validation')
    test_df = sample_rows_for_events(dataset_csv, test_events, dtypes, max_rows=4000, seed=config.random_seed + 2, log=log, label='Stage 1 testing')
    if train_df.empty or val_df.empty or test_df.empty:
        raise ValueError('One of the Stage 1 splits is empty after loading the dataset.')

    preprocessor1, num_features, cat_features = build_stage1_preprocessor(header_cols)
    stage1_model, _, _, stage1_loss_png, stage1_mae = run_stage1(train_df, val_df, test_df, preprocessor1, config, log, plot_dir, model_dir)
    plot_files: Dict[str, Path] = {stage1_loss_png.name: stage1_loss_png}
    output_files: Dict[str, Path] = {}

    residual_model = None
    stage2_preprocessor = None
    stage2_summary = {}
    stage2_enabled_and_ready = config.stage2_enabled and bool(config.stage2_event) and label_asc is not None
    if stage2_enabled_and_ready:
        residual_model, stage2_preprocessor, stage2_loss_png, roc_png, stage2_summary = run_stage2(dataset_csv, dtypes, preprocessor1, stage1_model, cat_features, config, label_asc, log, plot_dir, model_dir)
        plot_files[stage2_loss_png.name] = stage2_loss_png
        plot_files[roc_png.name] = roc_png
    else:
        stage2_loss_png = plot_dir / 'stage2_loss.png'
        roc_png = plot_dir / 'roc_curve.png'
        plot_message(stage2_loss_png, 'Stage 2 not active', 'Stage 2 training was disabled or label input was not provided.')
        plot_message(roc_png, 'ROC not available', 'ROC requires an active Stage 2 event with landslide_label.asc.')
        plot_files[stage2_loss_png.name] = stage2_loss_png
        plot_files[roc_png.name] = roc_png

    _, ref_meta = read_asc(reference_asc)
    output_meta = ref_meta.copy()
    output_meta['nodata_value'] = -9999.0
    prediction_csv = output_dir / 'predictions_stage1.csv'
    metrics_txt = output_dir / 'metrics_summary.txt'
    donut_png = plot_dir / 'pof_proportion_donut_panel.png'
    first_pred_write = True
    donut_records = []
    metrics_lines = []

    for event_id in test_events:
        geotop_grid = np.full(output_meta['nrows'] * output_meta['ncols'], output_meta['nodata_value'], dtype=np.float32)
        stage1_grid = np.full_like(geotop_grid, output_meta['nodata_value'])
        stage2_grid = np.full_like(geotop_grid, output_meta['nodata_value']) if residual_model is not None and stage2_preprocessor is not None else None
        probs_geo_parts = []
        probs_s1_parts = []
        probs_s2_parts = []
        for event_chunk in chunk_reader_for_events(dataset_csv, [event_id], dtypes):
            X_event1 = preprocessor1.transform(event_chunk)
            raw_stage1 = stage1_model.predict(X_event1).astype(np.float32)
            stage1_pred = np.clip(raw_stage1, 0.0, 1.0)
            grid_ids = event_chunk['grid_id'].astype(np.int64).values
            geotop_prob = event_chunk['pof_form'].astype(np.float32).values
            geotop_grid[grid_ids] = geotop_prob
            stage1_grid[grid_ids] = stage1_pred
            event_chunk['stage1_base_prob'] = stage1_pred
            event_chunk['stage1_base_logit'] = raw_stage1
            probs_geo_parts.append(geotop_prob)
            probs_s1_parts.append(stage1_pred)
            if stage2_grid is not None:
                event_chunk['base_logit'] = raw_stage1
                X_event2 = stage2_preprocessor.transform(event_chunk)
                stage2_prob = residual_model.predict_proba(X_event2)[:, 1].astype(np.float32)
                stage2_grid[grid_ids] = stage2_prob
                event_chunk['stage2_final_prob'] = stage2_prob
                probs_s2_parts.append(stage2_prob)
            event_chunk.to_csv(prediction_csv, mode='w' if first_pred_write else 'a', header=first_pred_write, index=False)
            first_pred_write = False
        if not probs_geo_parts:
            continue
        geotop_prob_all = np.concatenate(probs_geo_parts)
        stage1_prob_all = np.concatenate(probs_s1_parts)
        rings = [('GeoTOP-FORM', compute_pof_proportions(geotop_prob_all)), ('Stage 1', compute_pof_proportions(stage1_prob_all))]
        geotop_out = map_dir / f'geotop_form_pof_{event_id}.asc'
        stage1_out = map_dir / f'stage1_base_prob_{event_id}.asc'
        write_asc(geotop_out, geotop_grid.reshape((output_meta['nrows'], output_meta['ncols'])), output_meta)
        write_asc(stage1_out, stage1_grid.reshape((output_meta['nrows'], output_meta['ncols'])), output_meta)
        output_files[geotop_out.name] = geotop_out
        output_files[stage1_out.name] = stage1_out
        metrics_lines.append(f'Event {event_id}: Stage 1 mean prob={float(np.mean(stage1_prob_all)):.4f}')
        if stage2_grid is not None and probs_s2_parts:
            stage2_prob_all = np.concatenate(probs_s2_parts)
            stage2_out = map_dir / f'stage2_final_prob_{event_id}.asc'
            write_asc(stage2_out, stage2_grid.reshape((output_meta['nrows'], output_meta['ncols'])), output_meta)
            output_files[stage2_out.name] = stage2_out
            rings.append(('Stage 2', compute_pof_proportions(stage2_prob_all)))
            metrics_lines.append(f'Event {event_id}: Stage 2 mean prob={float(np.mean(stage2_prob_all)):.4f}')
        donut_records.append({'event_id': event_id, 'rings': rings})

    if first_pred_write:
        pd.DataFrame().to_csv(prediction_csv, index=False)
    draw_combined_donut_panel(donut_records, donut_png)
    plot_files[donut_png.name] = donut_png
    output_files[prediction_csv.name] = prediction_csv

    with metrics_txt.open('w', encoding='utf-8') as f:
        f.write('Machine learning summary\n')
        f.write('=' * 60 + '\n')
        f.write('Runtime mode: ultra_low_memory_sgd\n')
        f.write(f'Train events: {train_events}\n')
        f.write(f'Val events: {val_events}\n')
        f.write(f'Test events: {test_events}\n')
        f.write(f'Stage 1 MAE (sampled test rows): {stage1_mae:.6f}\n')
        for line in metrics_lines:
            f.write(line + '\n')
        if stage2_summary:
            f.write(json.dumps(stage2_summary, indent=2) + '\n')
        else:
            f.write('Stage 2 was disabled or not configured.\n')
    output_files[metrics_txt.name] = metrics_txt

    summary = {
        'runtime_mode': 'memory_optimised_original_like_mlp',
        'stage1_train_events': train_events,
        'stage1_val_events': val_events,
        'stage1_test_events': test_events,
        'stage1_feature_count': len(num_features) + len(cat_features),
        'stage1_softlabel_mae': stage1_mae,
        'stage2_enabled': bool(stage2_enabled_and_ready),
        'memory_strategy': 'chunked_sampling_plus_mlp_models',
        **stage2_summary,
    }
    return MLResult(summary=summary, output_files=output_files, plot_files=plot_files)
