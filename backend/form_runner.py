from __future__ import annotations

import os
import re
from dataclasses import dataclass
from math import erf, sqrt
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Tuple

import numpy as np

LogFn = Callable[[str], None]

OUT_NODATA = -9999.0
GAMMA_W = 9.81  # kN/m^3
MIN_SLOPE_DEG = 0.1
EPS = 1e-12
LAYER_DEPTHS_M = np.array([0.01, 0.05, 0.13, 0.25, 0.45, 0.75, 1.10, 1.50], dtype=float)
LAYER_TOPS_M = np.concatenate(([0.0], LAYER_DEPTHS_M[:-1]))
N_LAYERS = len(LAYER_DEPTHS_M)


@dataclass
class SoilParam:
    soil_id: int
    name: str
    phi_deg: float
    phi_cov: float
    c_kpa: float
    c_cov: float
    gamma_s: float
    rho_c_phi: float


@dataclass
class FormSettings:
    psi_file_style: str
    psi_unit: str
    soilthickness_unit: str
    use_multiple_timesteps: bool
    single_time_code: str
    soil_params: Dict[int, SoilParam]


@dataclass
class InputPaths:
    slope_asc: Path
    soiltype_asc: Path
    soilthickness_asc: Path
    pwp_folder: Path
    dem_asc: Path | None = None


@dataclass
class RunResult:
    outputs: Dict[str, Path]
    summary: Dict[str, str]


# =========================
# ASCII GRID HELPERS
# =========================
def read_ascii_grid(path: Path) -> Tuple[np.ndarray, dict]:
    header = {}
    with open(path, "r", encoding="utf-8") as f:
        for _ in range(6):
            line = f.readline().strip()
            if not line:
                raise ValueError(f"Invalid ASCII grid header in {path.name}")
            key, value = line.split(None, 1)
            header[key.lower()] = value

        ncols = int(header["ncols"])
        nrows = int(header["nrows"])
        nodata = float(header.get("nodata_value", -9999))
        data = np.loadtxt(f, dtype=float).reshape((nrows, ncols))

    header_out = {
        "ncols": ncols,
        "nrows": nrows,
        "xllcorner": header.get("xllcorner", header.get("xllcenter", "0")),
        "yllcorner": header.get("yllcorner", header.get("yllcenter", "0")),
        "cellsize": float(header["cellsize"]),
        "nodata": nodata,
    }
    return data, header_out


def write_ascii_grid(path: Path, data: np.ndarray, header: dict, nodata: float = OUT_NODATA) -> None:
    arr = np.array(data, dtype=float).copy()
    arr[~np.isfinite(arr)] = nodata

    with open(path, "w", encoding="utf-8") as f:
        f.write(f"ncols         {header['ncols']}\n")
        f.write(f"nrows         {header['nrows']}\n")
        f.write(f"xllcorner     {header['xllcorner']}\n")
        f.write(f"yllcorner     {header['yllcorner']}\n")
        f.write(f"cellsize      {header['cellsize']}\n")
        f.write(f"NODATA_value  {nodata}\n")
        for row in arr:
            f.write(" ".join(f"{v:.6f}" for v in row) + "\n")


def check_same_grid(h1: dict, h2: dict, name1: str = "grid1", name2: str = "grid2") -> None:
    keys = ["ncols", "nrows", "xllcorner", "yllcorner", "cellsize"]
    for key in keys:
        if str(h1[key]) != str(h2[key]):
            raise ValueError(f"Grid mismatch in {key}: {name1}={h1[key]} vs {name2}={h2[key]}")


# =========================
# CONVERSIONS
# =========================
def psi_to_head_m(psi: np.ndarray, psi_unit: str) -> np.ndarray:
    if psi_unit == "mm_head":
        return psi / 1000.0
    if psi_unit == "m_head":
        return psi
    if psi_unit == "pressure_pa":
        return psi / 9810.0
    raise ValueError("psi_unit must be one of: mm_head, m_head, pressure_pa")


def soilthickness_to_m(h: np.ndarray, soilthickness_unit: str) -> np.ndarray:
    if soilthickness_unit == "m":
        return h
    if soilthickness_unit == "mm":
        return h / 1000.0
    raise ValueError("soilthickness_unit must be 'm' or 'mm'")


def std_norm_cdf(x: np.ndarray) -> np.ndarray:
    return 0.5 * (1.0 + np.vectorize(erf)(x / sqrt(2.0)))


# =========================
# PARAMETER RASTERS
# =========================
def build_parameter_rasters(soiltype: np.ndarray, soil_params: Dict[int, SoilParam]):
    phi_deg = np.full(soiltype.shape, np.nan, dtype=float)
    phi_cov = np.full(soiltype.shape, np.nan, dtype=float)
    c_kpa = np.full(soiltype.shape, np.nan, dtype=float)
    c_cov = np.full(soiltype.shape, np.nan, dtype=float)
    gamma_s = np.full(soiltype.shape, np.nan, dtype=float)
    rho_c_phi = np.full(soiltype.shape, np.nan, dtype=float)

    for soil_id, p in soil_params.items():
        mask = soiltype == soil_id
        phi_deg[mask] = p.phi_deg
        phi_cov[mask] = p.phi_cov
        c_kpa[mask] = p.c_kpa
        c_cov[mask] = p.c_cov
        gamma_s[mask] = p.gamma_s
        rho_c_phi[mask] = p.rho_c_phi

    return phi_deg, phi_cov, c_kpa, c_cov, gamma_s, rho_c_phi


# =========================
# PWP FILE HELPERS
# =========================
def build_psi_filename(layer_index: int, time_code: str, psi_file_style: str) -> str:
    if psi_file_style == "psiz":
        return f"psizL{layer_index:04d}N{time_code}.asc"
    if psi_file_style == "soilliq":
        return f"SoilLiqWaterPressL{layer_index:04d}N{time_code}.asc"
    raise ValueError("psi_file_style must be 'psiz' or 'soilliq'")


def detect_all_time_codes(folder: Path, psi_file_style: str) -> List[str]:
    pattern = (
        re.compile(r"^psizL0000N(\d+)\.asc$", re.IGNORECASE)
        if psi_file_style == "psiz"
        else re.compile(r"^SoilLiqWaterPressL0000N(\d+)\.asc$", re.IGNORECASE)
    )

    codes = set()
    for fn in os.listdir(folder):
        match = pattern.match(fn)
        if match:
            codes.add(match.group(1))

    ordered = sorted(codes, key=lambda x: int(x))
    if not ordered:
        raise FileNotFoundError("No time codes detected in uploaded PWP folder.")
    return ordered


def get_time_codes(settings: FormSettings, folder: Path) -> List[str]:
    return detect_all_time_codes(folder, settings.psi_file_style) if settings.use_multiple_timesteps else [settings.single_time_code]


def read_time_step_profiles(folder: Path, time_code: str, hdr_ref: dict, settings: FormSettings):
    all_layers = []
    nodata_values = []

    for layer_index in range(0, N_LAYERS + 1):
        fname = build_psi_filename(layer_index, time_code, settings.psi_file_style)
        fpath = folder / fname
        if not fpath.exists():
            raise FileNotFoundError(f"Missing PWP file for time {time_code}: {fname}")

        arr, hdr = read_ascii_grid(fpath)
        check_same_grid(hdr_ref, hdr, "reference", fname)
        all_layers.append(arr)
        nodata_values.append(hdr["nodata"])

    return np.stack(all_layers, axis=0), nodata_values


# =========================
# DEPTH / FOS / BETA
# =========================
def build_effective_depth_stack(soilthickness_m: np.ndarray) -> np.ndarray:
    effective_depths = np.full((N_LAYERS,) + soilthickness_m.shape, np.nan, dtype=float)
    for k in range(N_LAYERS):
        top = LAYER_TOPS_M[k]
        bottom = LAYER_DEPTHS_M[k]
        exists = soilthickness_m > top
        effective_depths[k, exists] = np.minimum(soilthickness_m[exists], bottom)
    return effective_depths


def compute_fos_given_params(
    slope_deg: np.ndarray,
    psi_raw: np.ndarray,
    surface_pressure_raw: np.ndarray,
    z_m: np.ndarray,
    phi_deg: np.ndarray,
    c_kpa: np.ndarray,
    gamma_s: np.ndarray,
    psi_unit: str,
) -> np.ndarray:
    psi_head_m = psi_to_head_m(psi_raw, psi_unit)
    u_kpa = psi_head_m * GAMMA_W

    u0_head_m = psi_to_head_m(surface_pressure_raw, psi_unit)
    u0_kpa = np.maximum(u0_head_m * GAMMA_W, 0.0)

    slope_safe = np.maximum(slope_deg, MIN_SLOPE_DEG)
    beta_slope = np.radians(slope_safe)
    phi = np.radians(phi_deg)
    phi_b = np.radians((2.0 / 3.0) * phi_deg)

    z_safe = np.maximum(z_m, EPS)
    denom = gamma_s * z_safe * np.sin(beta_slope) * np.cos(beta_slope)
    denom = np.maximum(denom, EPS)

    base_term = c_kpa / denom + np.tan(phi) / np.tan(beta_slope)
    surface_term = (u0_kpa * np.tan(phi)) / denom

    fos_unsat = base_term - (u_kpa * np.tan(phi_b)) / denom + surface_term
    fos_sat = base_term - (u_kpa * np.tan(phi)) / denom + surface_term

    fos = np.where(u_kpa < 0.0, fos_unsat, fos_sat)
    fos[~np.isfinite(fos)] = np.nan
    fos = np.maximum(fos, 0.0)
    return fos


def compute_g_given_params(
    slope_deg: np.ndarray,
    psi_raw: np.ndarray,
    surface_pressure_raw: np.ndarray,
    z_m: np.ndarray,
    phi_deg: np.ndarray,
    c_kpa: np.ndarray,
    gamma_s: np.ndarray,
    psi_unit: str,
) -> np.ndarray:
    return compute_fos_given_params(
        slope_deg=slope_deg,
        psi_raw=psi_raw,
        surface_pressure_raw=surface_pressure_raw,
        z_m=z_m,
        phi_deg=phi_deg,
        c_kpa=c_kpa,
        gamma_s=gamma_s,
        psi_unit=psi_unit,
    ) - 1.0


def compute_beta_layer(
    slope_deg: np.ndarray,
    soiltype: np.ndarray,
    psi_raw: np.ndarray,
    surface_pressure_raw: np.ndarray,
    z_m: np.ndarray,
    nodata_mask: np.ndarray,
    settings: FormSettings,
    prebuilt_params=None,
) -> np.ndarray:
    if prebuilt_params is None:
        phi_deg, phi_cov, c_kpa, c_cov, gamma_s, rho_c_phi = build_parameter_rasters(soiltype, settings.soil_params)
    else:
        phi_deg, phi_cov, c_kpa, c_cov, gamma_s, rho_c_phi = prebuilt_params

    mu_g = compute_g_given_params(
        slope_deg=slope_deg,
        psi_raw=psi_raw,
        surface_pressure_raw=surface_pressure_raw,
        z_m=z_m,
        phi_deg=phi_deg,
        c_kpa=c_kpa,
        gamma_s=gamma_s,
        psi_unit=settings.psi_unit,
    )

    sigma_c = c_kpa * c_cov
    sigma_phi = phi_deg * phi_cov

    dc = np.maximum(1e-6, 0.01 * np.maximum(c_kpa, 1e-9))
    dphi = np.maximum(1e-4, 0.01 * np.maximum(phi_deg, 1e-9))

    g_c_plus = compute_g_given_params(slope_deg, psi_raw, surface_pressure_raw, z_m, phi_deg, c_kpa + dc, gamma_s, settings.psi_unit)
    g_c_minus = compute_g_given_params(slope_deg, psi_raw, surface_pressure_raw, z_m, phi_deg, np.maximum(c_kpa - dc, 1e-9), gamma_s, settings.psi_unit)
    dg_dc = (g_c_plus - g_c_minus) / (2.0 * dc)

    g_phi_plus = compute_g_given_params(slope_deg, psi_raw, surface_pressure_raw, z_m, phi_deg + dphi, c_kpa, gamma_s, settings.psi_unit)
    g_phi_minus = compute_g_given_params(slope_deg, psi_raw, surface_pressure_raw, z_m, np.maximum(phi_deg - dphi, 1e-9), c_kpa, gamma_s, settings.psi_unit)
    dg_dphi = (g_phi_plus - g_phi_minus) / (2.0 * dphi)

    var_g = (
        (dg_dc ** 2) * (sigma_c ** 2)
        + (dg_dphi ** 2) * (sigma_phi ** 2)
        + 2.0 * rho_c_phi * dg_dc * dg_dphi * sigma_c * sigma_phi
    )
    var_g = np.where(var_g < 0, 0, var_g)
    sigma_g = np.sqrt(var_g)

    beta = np.full(mu_g.shape, np.nan, dtype=float)
    mask_sigma = sigma_g > 0
    beta[mask_sigma] = mu_g[mask_sigma] / sigma_g[mask_sigma]

    mask_zero = ~mask_sigma
    beta[mask_zero & (mu_g > 0)] = 10.0
    beta[mask_zero & (mu_g < 0)] = -10.0
    beta[mask_zero & (mu_g == 0)] = 0.0
    beta[nodata_mask] = np.nan
    return beta


def _log_stats(log: LogFn, name: str, arr: np.ndarray) -> None:
    valid = arr[np.isfinite(arr)]
    if valid.size == 0:
        log(f"{name}: no valid cells")
        return
    log(f"{name}: min={np.nanmin(valid):.6f}, max={np.nanmax(valid):.6f}")


# =========================
# MAIN RUNNER
# =========================
def run_form(inputs: InputPaths, settings: FormSettings, output_dir: Path, log: LogFn) -> RunResult:
    output_dir.mkdir(parents=True, exist_ok=True)

    log("Reading uploaded ASCII grids...")
    slope, hdr_slope = read_ascii_grid(inputs.slope_asc)
    soiltype, hdr_soil = read_ascii_grid(inputs.soiltype_asc)
    soilthickness_raw, hdr_h = read_ascii_grid(inputs.soilthickness_asc)

    check_same_grid(hdr_slope, hdr_soil, "slope", "soiltype")
    check_same_grid(hdr_slope, hdr_h, "slope", "soilthickness")

    soilthickness = soilthickness_to_m(soilthickness_raw, settings.soilthickness_unit)

    slope_nodata = hdr_slope["nodata"]
    soil_nodata = hdr_soil["nodata"]
    h_nodata = hdr_h["nodata"]

    valid_soil_ids = list(settings.soil_params.keys())
    base_nodata_mask = (
        (slope == slope_nodata)
        | (soiltype == soil_nodata)
        | (soilthickness_raw == h_nodata)
        | (soilthickness <= 0)
        | (~np.isin(soiltype, valid_soil_ids))
    )

    params = build_parameter_rasters(soiltype, settings.soil_params)
    effective_depth_stack = build_effective_depth_stack(soilthickness)

    rows, cols = slope.shape
    fs_min_global = np.full((rows, cols), np.nan, dtype=float)
    critical_psi_stack = np.full((N_LAYERS, rows, cols), np.nan, dtype=float)
    critical_surface_pressure = np.full((rows, cols), np.nan, dtype=float)

    time_codes = get_time_codes(settings, inputs.pwp_folder)
    log(f"Detected time codes: {', '.join(time_codes)}")
    log(f"PSI file style: {settings.psi_file_style}")
    log(f"PSI unit: {settings.psi_unit}")
    log(f"Soil thickness unit: {settings.soilthickness_unit}")

    for time_code in time_codes:
        log(f"Reading time code {time_code}...")
        pwp_profile_stack, pwp_nodata_values = read_time_step_profiles(inputs.pwp_folder, time_code, hdr_slope, settings)

        surface_pressure = pwp_profile_stack[0]
        psi_stack = pwp_profile_stack[1:]
        time_fos_stack = []

        for k in range(N_LAYERS):
            psi = psi_stack[k]
            psi_nodata = pwp_nodata_values[k + 1]
            z_eff = effective_depth_stack[k]
            layer_exists = np.isfinite(z_eff)

            final_mask = base_nodata_mask | (surface_pressure == pwp_nodata_values[0]) | (psi == psi_nodata) | (~layer_exists)

            fos = compute_fos_given_params(
                slope_deg=slope,
                psi_raw=psi,
                surface_pressure_raw=surface_pressure,
                z_m=np.where(layer_exists, z_eff, 1.0),
                phi_deg=params[0],
                c_kpa=params[2],
                gamma_s=params[4],
                psi_unit=settings.psi_unit,
            )
            fos[final_mask] = np.nan
            time_fos_stack.append(fos)

        time_fos_stack = np.stack(time_fos_stack, axis=0)
        valid_time_mask = np.any(np.isfinite(time_fos_stack), axis=0)

        fs_min_time = np.full((rows, cols), np.nan, dtype=float)
        fs_min_time[valid_time_mask] = np.nanmin(time_fos_stack[:, valid_time_mask], axis=0)

        update_mask = valid_time_mask & (~np.isfinite(fs_min_global) | (fs_min_time < fs_min_global))
        if np.any(update_mask):
            fs_min_global[update_mask] = fs_min_time[update_mask]
            critical_surface_pressure[update_mask] = surface_pressure[update_mask]
            for k in range(N_LAYERS):
                critical_psi_stack[k, update_mask] = psi_stack[k, update_mask]

        valid_cells = int(np.sum(np.isfinite(fs_min_time)))
        log(f"Finished time code {time_code}: {valid_cells} valid cells")

    final_fos_stack = []
    final_beta_stack = []

    for k in range(N_LAYERS):
        psi = critical_psi_stack[k]
        z_eff = effective_depth_stack[k]
        layer_exists = np.isfinite(z_eff)

        final_mask = base_nodata_mask | (~layer_exists) | (~np.isfinite(psi)) | (~np.isfinite(critical_surface_pressure))

        fos = compute_fos_given_params(
            slope_deg=slope,
            psi_raw=psi,
            surface_pressure_raw=critical_surface_pressure,
            z_m=np.where(layer_exists, z_eff, 1.0),
            phi_deg=params[0],
            c_kpa=params[2],
            gamma_s=params[4],
            psi_unit=settings.psi_unit,
        )
        fos[final_mask] = np.nan
        final_fos_stack.append(fos)

        beta_layer = compute_beta_layer(
            slope_deg=slope,
            soiltype=soiltype,
            psi_raw=psi,
            surface_pressure_raw=critical_surface_pressure,
            z_m=np.where(layer_exists, z_eff, 1.0),
            nodata_mask=final_mask,
            settings=settings,
            prebuilt_params=params,
        )
        final_beta_stack.append(beta_layer)
        log(f"Processed final layer {k + 1}/{N_LAYERS}")

    final_fos_stack = np.stack(final_fos_stack, axis=0)
    final_beta_stack = np.stack(final_beta_stack, axis=0)
    valid_mask = np.any(np.isfinite(final_fos_stack), axis=0)

    fs_min = np.full((rows, cols), np.nan, dtype=float)
    fs_min_depth = np.full((rows, cols), np.nan, dtype=float)
    beta_map = np.full((rows, cols), np.nan, dtype=float)
    pof_map = np.full((rows, cols), np.nan, dtype=float)

    fs_min[valid_mask] = np.nanmin(final_fos_stack[:, valid_mask], axis=0)

    fos_for_argmin = np.where(np.isfinite(final_fos_stack), final_fos_stack, np.inf)
    fs_min_idx_valid = np.argmin(fos_for_argmin[:, valid_mask], axis=0)

    depth_valid_stack = effective_depth_stack[:, valid_mask]
    fs_min_depth[valid_mask] = depth_valid_stack[fs_min_idx_valid, np.arange(depth_valid_stack.shape[1])]

    beta_valid_stack = final_beta_stack[:, valid_mask]
    beta_map[valid_mask] = beta_valid_stack[fs_min_idx_valid, np.arange(beta_valid_stack.shape[1])]
    pof_map[valid_mask] = std_norm_cdf(-beta_map[valid_mask])

    _log_stats(log, "FS_min", fs_min)
    _log_stats(log, "FS_min_depth", fs_min_depth)
    _log_stats(log, "beta", beta_map)
    _log_stats(log, "PoF", pof_map)

    outputs = {
        "FS_min.asc": output_dir / "FS_min.asc",
        "FS_min_depth.asc": output_dir / "FS_min_depth.asc",
        "beta.asc": output_dir / "beta.asc",
        "PoF.asc": output_dir / "PoF.asc",
    }

    write_ascii_grid(outputs["FS_min.asc"], fs_min, hdr_slope)
    write_ascii_grid(outputs["FS_min_depth.asc"], fs_min_depth, hdr_slope)
    write_ascii_grid(outputs["beta.asc"], beta_map, hdr_slope)
    write_ascii_grid(outputs["PoF.asc"], pof_map, hdr_slope)

    log("Saved FS_min.asc")
    log("Saved FS_min_depth.asc")
    log("Saved beta.asc")
    log("Saved PoF.asc")
    log("FORM run completed")

    summary = {
        "rows": str(rows),
        "cols": str(cols),
        "time_codes": ", ".join(time_codes),
        "output_directory": str(output_dir),
    }

    return RunResult(outputs=outputs, summary=summary)
