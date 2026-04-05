from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Tuple

import numpy as np
import pandas as pd

LogFn = Callable[[str], None]

EXPECTED_MAPS: Dict[str, str] = {
    "pit.asc": "elevation",
    "slope_fixed.asc": "slope",
    "slope.asc": "slope",
    "soiltype.asc": "soiltype_code",
    "soilthickness.asc": "soil_thickness",
    "ValleyDepth_30.asc": "valley_depth",
    "TWI_30.asc": "twi",
    "TST_30.asc": "tst",
    "TRI_30.asc": "tri",
    "TPI_30.asc": "tpi",
    "SPI_30.asc": "spi",
    "RelativeSlopePosition_30.asc": "relative_slope_position",
    "ProfileCurvature_30.asc": "profile_curvature",
    "PlanCurvature_30.asc": "plan_curvature",
    "NDVI_30.asc": "ndvi",
    "MeltonRuggednessNumber_30.asc": "melton_ruggedness_number",
    "Maximum_Height_30.asc": "maximum_height",
    "LS-Factor_30.asc": "ls_factor",
    "InCatchmentArea_30.asc": "in_catchment_area",
    "Distance_to_fault.asc": "distance_to_fault",
    "Distance_to_Channel.asc": "distance_to_channel",
    "Convexity.asc": "convexity",
    "Convergence_Index_30.asc": "convergence_index",
    "aspect_fixed.asc": "aspect",
    "landcover_fixed.asc": "landcover_code",
}

SOILTYPE_NAME_MAP = {1: "Qg", 2: "Hs", 3: "Hi"}
RAINFALL_DEFAULTS = {
    "20110808": {"E": 82.8, "D": 3.0, "PI": 73.7},
    "20120305": {"E": 45.1, "D": 23.0, "PI": 7.8},
    "20120618": {"E": 211.2, "D": 37.0, "PI": 24.4},
    "20130825": {"E": 53.6, "D": 5.0, "PI": 28.0},
    "20140514": {"E": 74.5, "D": 9.0, "PI": 17.3},
    "20150622": {"E": 61.3, "D": 32.0, "PI": 9.2},
    "20170614": {"E": 154.4, "D": 55.0, "PI": 13.1},
    "20190421": {"E": 87.4, "D": 6.0, "PI": 63.2},
    "20190619": {"E": 143.5, "D": 20.0, "PI": 54.9},
    "20190713": {"E": 159.7, "D": 25.0, "PI": 34.0},
    "20190811": {"E": 168.5, "D": 40.0, "PI": 16.7},
    "20200603": {"E": 81.5, "D": 17.0, "PI": 50.1},
    "20200619": {"E": 151.6, "D": 22.0, "PI": 26.0},
    "20200828": {"E": 38.7, "D": 6.0, "PI": 18.0},
    "20210610": {"E": 131.4, "D": 4.0, "PI": 41.8},
}

CHUNK_SIZE = 50000
PREVIEW_ROWS = 300


@dataclass
class PrepResult:
    dataset_csv: Path
    preview_csv: Path
    summary: Dict[str, object]
    detected_maps: List[Dict[str, str]]
    detected_events: List[str]


def read_asc(filepath: Path):
    with filepath.open("r", encoding="utf-8") as f:
        ncols = int(f.readline().split()[1])
        nrows = int(f.readline().split()[1])
        xllcorner = float(f.readline().split()[1])
        yllcorner = float(f.readline().split()[1])
        cellsize = float(f.readline().split()[1])
        nodata_value = float(f.readline().split()[1])
    data = np.loadtxt(filepath, skiprows=6, dtype=np.float32)
    meta = {
        "ncols": ncols,
        "nrows": nrows,
        "xllcorner": xllcorner,
        "yllcorner": yllcorner,
        "cellsize": cellsize,
        "nodata_value": nodata_value,
    }
    return data, meta


def to_int_safe(val):
    if pd.isna(val):
        return np.nan
    try:
        return int(round(float(val)))
    except Exception:
        return np.nan


def soiltype_to_name(val):
    ival = to_int_safe(val)
    if pd.isna(ival):
        return np.nan
    return SOILTYPE_NAME_MAP.get(ival, f"soil_{ival}")


def landcover_to_name(val):
    ival = to_int_safe(val)
    if pd.isna(ival):
        return np.nan
    return f"lc_{ival}"


def build_map_defs(maps_dir: Path) -> Tuple[Dict[str, Path], List[Dict[str, str]]]:
    all_asc = sorted(p for p in maps_dir.glob("*.asc"))
    if not all_asc:
        raise FileNotFoundError("No ASC map files found in uploaded map folder.")

    selected: Dict[str, Path] = {}
    detected = []
    for path in all_asc:
        column_name = EXPECTED_MAPS.get(path.name)
        if not column_name:
            column_name = path.stem.lower().replace("-", "_").replace(" ", "_")
        if column_name in selected:
            if path.name in EXPECTED_MAPS:
                selected[column_name] = path
        else:
            selected[column_name] = path
        detected.append({"file": path.name, "column": column_name})
    return selected, detected


def detect_event_pof_maps(form_outputs_dir: Path) -> Dict[str, Path]:
    events: Dict[str, Path] = {}
    for pof in form_outputs_dir.rglob("PoF.asc"):
        rel = pof.relative_to(form_outputs_dir)
        parts = rel.parts
        event_id = parts[-2] if len(parts) >= 2 else pof.parent.name
        events[event_id] = pof
    if not events:
        raise FileNotFoundError("No PoF.asc found inside uploaded FORM outputs folder.")
    return dict(sorted(events.items()))


def prepare_stage1_dataset(
    maps_dir: Path,
    form_outputs_dir: Path,
    rainfall_by_event: Dict[str, Dict[str, float]],
    output_dir: Path,
    log: LogFn,
) -> PrepResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    dataset_csv = output_dir / "stage1_base_dataset.csv"
    preview_csv = output_dir / "stage1_base_dataset_preview.csv"

    map_defs, detected_maps = build_map_defs(maps_dir)
    if "elevation" not in map_defs:
        raise FileNotFoundError("Missing pit.asc / elevation map in uploaded maps folder.")

    log(f"Reading {len(map_defs)} uploaded maps with memory-optimized pipeline")
    flat_maps: Dict[str, np.ndarray] = {}
    nodata_map: Dict[str, float] = {}
    ref_shape = None
    nrows = ncols = None
    for col_name, filepath in map_defs.items():
        arr, meta = read_asc(filepath)
        if ref_shape is None:
            ref_shape = arr.shape
            nrows, ncols = arr.shape
        elif arr.shape != ref_shape:
            raise ValueError(f"Shape mismatch for {col_name}: {arr.shape} vs {ref_shape}")
        flat_maps[col_name] = arr.ravel()
        nodata_map[col_name] = meta["nodata_value"]
        log(f"Loaded map {filepath.name} -> {col_name} ({arr.shape[0]} x {arr.shape[1]})")
        del arr

    valid_mask = np.ones(nrows * ncols, dtype=bool)
    for col_name, values in flat_maps.items():
        valid_mask &= values != nodata_map[col_name]
    valid_indices = np.flatnonzero(valid_mask)
    log(f"Static valid cells kept: {len(valid_indices):,} / {nrows * ncols:,}")

    event_pofs = detect_event_pof_maps(form_outputs_dir)
    detected_events = list(event_pofs.keys())
    log(f"Detected {len(detected_events)} FORM event folders with PoF.asc")

    preferred = [
        "grid_id", "event_id", "elevation", "slope", "soil_thickness", "soiltype_code", "geology",
        "landcover_code", "landcover_class", "E", "D", "PI", "pof_form",
    ]
    map_cols = [c for c in flat_maps.keys() if c not in {"elevation", "slope", "soil_thickness", "soiltype_code", "landcover_code"}]
    ordered_columns = preferred + map_cols

    preview_df = None
    total_rows = 0
    event_row_counts: Dict[str, int] = {}
    first_write = True

    for event_id, pof_file in event_pofs.items():
        pof_arr, pof_meta = read_asc(pof_file)
        if pof_arr.shape != ref_shape:
            raise ValueError(f"PoF grid shape mismatch for event {event_id}: {pof_arr.shape} vs {ref_shape}")
        pof_flat = pof_arr.ravel()
        event_mask = pof_flat[valid_indices] != pof_meta["nodata_value"]
        event_indices = valid_indices[event_mask]
        rain = rainfall_by_event.get(event_id, RAINFALL_DEFAULTS.get(event_id, {"E": 0.0, "D": 0.0, "PI": 0.0}))
        event_rows = 0

        for start in range(0, len(event_indices), CHUNK_SIZE):
            idx = event_indices[start:start + CHUNK_SIZE]
            chunk = {
                "grid_id": idx.astype(np.int64),
                "event_id": np.full(idx.shape, str(event_id), dtype=object),
                "E": np.full(idx.shape, float(rain.get("E", 0.0)), dtype=np.float32),
                "D": np.full(idx.shape, float(rain.get("D", 0.0)), dtype=np.float32),
                "PI": np.full(idx.shape, float(rain.get("PI", 0.0)), dtype=np.float32),
                "pof_form": pof_flat[idx].astype(np.float32),
            }
            for col_name, values in flat_maps.items():
                selected = values[idx]
                if col_name in {"soiltype_code", "landcover_code"}:
                    chunk[col_name] = selected.astype(np.int32)
                else:
                    chunk[col_name] = selected.astype(np.float32, copy=False)

            if "soiltype_code" in chunk:
                chunk["geology"] = np.array([soiltype_to_name(v) for v in chunk["soiltype_code"]], dtype=object)
            if "landcover_code" in chunk:
                chunk["landcover_class"] = np.array([landcover_to_name(v) for v in chunk["landcover_code"]], dtype=object)

            chunk_df = pd.DataFrame({col: chunk[col] for col in ordered_columns if col in chunk})
            chunk_df.to_csv(dataset_csv, mode="w" if first_write else "a", header=first_write, index=False)
            first_write = False
            event_rows += len(chunk_df)
            total_rows += len(chunk_df)

            if preview_df is None:
                preview_df = chunk_df.head(PREVIEW_ROWS).copy()
            elif len(preview_df) < PREVIEW_ROWS:
                remaining = PREVIEW_ROWS - len(preview_df)
                preview_df = pd.concat([preview_df, chunk_df.head(remaining)], ignore_index=True)

            del chunk_df
            del chunk

        event_row_counts[event_id] = event_rows
        log(f"Event {event_id}: rows kept = {event_rows:,}")
        del pof_arr

    if total_rows == 0:
        raise RuntimeError("No valid event data found after reading PoF maps.")

    if preview_df is None:
        preview_df = pd.DataFrame(columns=ordered_columns)
    preview_df.to_csv(preview_csv, index=False)

    summary = {
        "rows": int(total_rows),
        "events": detected_events,
        "event_count": len(detected_events),
        "maps_loaded": len(map_defs),
        "dataset_csv": dataset_csv.name,
        "preview_csv": preview_csv.name,
        "grid_shape": f"{nrows} x {ncols}",
        "event_rows": event_row_counts,
        "memory_mode": "streaming_chunked_csv",
    }
    log(f"Dataset saved to {dataset_csv.name} with {total_rows:,} rows")

    return PrepResult(
        dataset_csv=dataset_csv,
        preview_csv=preview_csv,
        summary=summary,
        detected_maps=detected_maps,
        detected_events=detected_events,
    )
