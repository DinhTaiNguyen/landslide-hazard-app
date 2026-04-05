from __future__ import annotations

import json
import os
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse

from form_runner import FormSettings, InputPaths, SoilParam, run_form
from ml_data_prep import RAINFALL_DEFAULTS, prepare_stage1_dataset
from ml_runner import MLConfig, run_ml_pipeline

BASE_DIR = Path(__file__).resolve().parent
RUNS_DIR = BASE_DIR / "runs"
RUNS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Landslide Hazard Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: Dict[str, dict] = {}


def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def save_upload(upload: UploadFile, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as f:
        shutil.copyfileobj(upload.file, f)
    return destination


def sanitize_relpath(filename: str) -> Path:
    name = filename.replace("\\", "/")
    parts = [p for p in name.split("/") if p not in ("", ".", "..")]
    if not parts:
        raise ValueError("Invalid uploaded filename")
    return Path(*parts)


def create_job(job_type: str, run_dir: Path, extra: Optional[dict] = None) -> str:
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {
        "job_id": job_id,
        "job_type": job_type,
        "status": "queued",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "logs": [f"[{now_iso()}] Job created"],
        "run_dir": str(run_dir),
        "outputs": {},
        "plots": {},
        "summary": {},
        "error": None,
        **(extra or {}),
    }
    return job_id


def append_log(job_id: str, message: str) -> None:
    JOBS[job_id]["logs"].append(f"[{now_iso()}] {message}")
    JOBS[job_id]["updated_at"] = now_iso()


@app.get("/")
def root() -> dict:
    return {
        "service": "Landslide Hazard Backend",
        "status": "ok",
        "health": "/api/health",
        "endpoints": ["/api/form/run", "/api/ml/prepare", "/api/ml/run"],
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "time": now_iso(), "rainfall_defaults": len(RAINFALL_DEFAULTS)}


@app.get("/api/rainfall-defaults")
def rainfall_defaults() -> dict:
    return {"defaults": RAINFALL_DEFAULTS}


@app.post("/api/form/run")
async def start_form_run(
    settings_json: str = Form(...),
    slope_file: UploadFile = File(...),
    soiltype_file: UploadFile = File(...),
    soilthickness_file: UploadFile = File(...),
    dem_file: UploadFile | None = File(None),
    pwp_files: List[UploadFile] = File(...),
):
    run_dir = RUNS_DIR / f"run_{uuid.uuid4().hex[:12]}"
    input_dir = run_dir / "inputs"
    pwp_dir = input_dir / "pwp"
    output_dir = run_dir / "outputs"
    input_dir.mkdir(parents=True, exist_ok=True)
    pwp_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        payload = json.loads(settings_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid settings_json: {exc}")

    soil_params = {
        int(item["soil_id"]): SoilParam(
            soil_id=int(item["soil_id"]),
            name=item.get("name", f"Soil {item['soil_id']}"),
            phi_deg=float(item["phi_deg"]),
            phi_cov=float(item["phi_cov"]),
            c_kpa=float(item["c_kpa"]),
            c_cov=float(item["c_cov"]),
            gamma_s=float(item["gamma_s"]),
            rho_c_phi=float(item["rho_c_phi"]),
        )
        for item in payload["soil_params"]
    }

    settings = FormSettings(
        psi_file_style=payload["psi_file_style"],
        psi_unit=payload["psi_unit"],
        soilthickness_unit=payload["soilthickness_unit"],
        use_multiple_timesteps=bool(payload.get("use_multiple_timesteps", True)),
        single_time_code=str(payload.get("single_time_code", "0001")),
        soil_params=soil_params,
    )

    inputs = InputPaths(
        slope_asc=save_upload(slope_file, input_dir / "slope.asc"),
        soiltype_asc=save_upload(soiltype_file, input_dir / "soiltype.asc"),
        soilthickness_asc=save_upload(soilthickness_file, input_dir / "soilthickness.asc"),
        dem_asc=save_upload(dem_file, input_dir / "dem.asc") if dem_file else None,
        pwp_folder=pwp_dir,
    )

    for upload in pwp_files:
        rel = sanitize_relpath(upload.filename)
        save_upload(upload, pwp_dir / rel.name)

    job_id = create_job("form", run_dir, extra={"output_dir_name": "outputs"})
    append_log(job_id, f"Uploaded {len(pwp_files)} PWP files")

    def worker() -> None:
        try:
            JOBS[job_id]["status"] = "running"
            append_log(job_id, "FORM job started")
            result = run_form(inputs=inputs, settings=settings, output_dir=output_dir, log=lambda m: append_log(job_id, m))
            JOBS[job_id]["outputs"] = {name: f"/api/jobs/{job_id}/download/{name}" for name in result.outputs.keys()}
            JOBS[job_id]["summary"] = result.summary
            JOBS[job_id]["status"] = "completed"
            append_log(job_id, "FORM job completed successfully")
        except Exception as exc:  # noqa: BLE001
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = str(exc)
            append_log(job_id, f"ERROR: {exc}")
        finally:
            JOBS[job_id]["updated_at"] = now_iso()

    threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id, "status": JOBS[job_id]["status"]}


@app.post("/api/ml/prepare")
async def prepare_ml_dataset(
    rainfall_json: str = Form(...),
    map_files: List[UploadFile] = File(...),
    form_output_files: List[UploadFile] = File(...),
):
    run_dir = RUNS_DIR / f"run_{uuid.uuid4().hex[:12]}"
    input_dir = run_dir / "inputs"
    maps_dir = input_dir / "maps"
    form_dir = input_dir / "form_outputs"
    output_dir = run_dir / "outputs"
    maps_dir.mkdir(parents=True, exist_ok=True)
    form_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        rainfall_by_event = json.loads(rainfall_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid rainfall_json: {exc}")

    for upload in map_files:
        rel = sanitize_relpath(upload.filename)
        save_upload(upload, maps_dir / rel.name)
    for upload in form_output_files:
        rel = sanitize_relpath(upload.filename)
        save_upload(upload, form_dir / rel)

    job_id = create_job("ml_prepare", run_dir, extra={"output_dir_name": "outputs"})
    append_log(job_id, f"Uploaded {len(map_files)} map files and {len(form_output_files)} FORM files")

    def worker() -> None:
        try:
            JOBS[job_id]["status"] = "running"
            append_log(job_id, "Machine learning data preparation started")
            result = prepare_stage1_dataset(maps_dir, form_dir, rainfall_by_event, output_dir, log=lambda m: append_log(job_id, m))
            JOBS[job_id]["outputs"] = {
                result.dataset_csv.name: f"/api/jobs/{job_id}/download/{result.dataset_csv.name}",
                result.preview_csv.name: f"/api/jobs/{job_id}/download/{result.preview_csv.name}",
            }
            JOBS[job_id]["summary"] = result.summary
            JOBS[job_id]["detected_maps"] = result.detected_maps
            JOBS[job_id]["detected_events"] = result.detected_events
            JOBS[job_id]["dataset_csv"] = str(result.dataset_csv)
            JOBS[job_id]["reference_asc"] = str((maps_dir / "pit.asc") if (maps_dir / "pit.asc").exists() else next(maps_dir.glob("*.asc")))
            JOBS[job_id]["status"] = "completed"
            append_log(job_id, "Machine learning data preparation completed")
        except Exception as exc:  # noqa: BLE001
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = str(exc)
            append_log(job_id, f"ERROR: {exc}")
        finally:
            JOBS[job_id]["updated_at"] = now_iso()

    threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id, "status": JOBS[job_id]["status"]}


@app.post("/api/ml/run")
async def run_ml(
    prep_job_id: str = Form(...),
    config_json: str = Form(...),
    label_file: UploadFile | None = File(None),
):
    prep_job = JOBS.get(prep_job_id)
    if not prep_job:
        raise HTTPException(status_code=404, detail="Preparation job not found")
    if prep_job.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Preparation job is not completed yet")

    try:
        payload = json.loads(config_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid config_json: {exc}")

    config = MLConfig(
        stage1_test_events=[str(x) for x in payload.get("stage1_test_events", [])],
        stage1_val_events=[str(x) for x in payload.get("stage1_val_events", [])],
        stage2_enabled=bool(payload.get("stage2_enabled", True)),
        stage2_event=str(payload["stage2_event"]) if payload.get("stage2_event") else None,
        batch_size_stage1=int(payload.get("batch_size_stage1", 8192)),
        batch_size_stage2=int(payload.get("batch_size_stage2", 4096)),
        epochs_stage1=int(payload.get("epochs_stage1", 80)),
        epochs_stage2=int(payload.get("epochs_stage2", 100)),
        lr_stage1=float(payload.get("lr_stage1", 1e-3)),
        lr_stage2=float(payload.get("lr_stage2", 1e-3)),
        weight_decay=float(payload.get("weight_decay", 1e-5)),
        patience_stage1=int(payload.get("patience_stage1", 10)),
        patience_stage2=int(payload.get("patience_stage2", 15)),
        min_delta=float(payload.get("min_delta", 1e-5)),
        stage2_train_frac=float(payload.get("stage2_train_frac", 0.60)),
        stage2_val_frac=float(payload.get("stage2_val_frac", 0.20)),
        stage2_test_frac=float(payload.get("stage2_test_frac", 0.20)),
        class_threshold=float(payload.get("class_threshold", 0.5)),
        random_seed=int(payload.get("random_seed", 42)),
    )

    run_dir = RUNS_DIR / f"run_{uuid.uuid4().hex[:12]}"
    input_dir = run_dir / "inputs"
    output_dir = run_dir / "outputs"
    plots_dir = output_dir / "plots"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    plots_dir.mkdir(parents=True, exist_ok=True)
    label_path = save_upload(label_file, input_dir / "landslide_label.asc") if label_file else None

    job_id = create_job("ml_run", run_dir, extra={"prep_job_id": prep_job_id, "output_dir_name": "outputs"})
    append_log(job_id, f"Machine learning run created from preparation job {prep_job_id}")

    def worker() -> None:
        try:
            JOBS[job_id]["status"] = "running"
            append_log(job_id, "Machine learning training started")
            result = run_ml_pipeline(
                dataset_csv=Path(prep_job["dataset_csv"]),
                reference_asc=Path(prep_job["reference_asc"]),
                config=config,
                output_dir=output_dir,
                label_asc=label_path,
                log=lambda m: append_log(job_id, m),
            )
            JOBS[job_id]["outputs"] = {name: f"/api/jobs/{job_id}/download/{name}" for name in result.output_files.keys()}
            JOBS[job_id]["plots"] = {name: f"/api/jobs/{job_id}/download/{name}" for name in result.plot_files.keys()}
            JOBS[job_id]["summary"] = result.summary
            JOBS[job_id]["status"] = "completed"
            append_log(job_id, "Machine learning training completed")
        except Exception as exc:  # noqa: BLE001
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = str(exc)
            append_log(job_id, f"ERROR: {exc}")
        finally:
            JOBS[job_id]["updated_at"] = now_iso()

    threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id, "status": JOBS[job_id]["status"]}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/jobs/{job_id}/download/{filename}")
def download_output(job_id: str, filename: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    run_dir = Path(job["run_dir"])
    matches = list(run_dir.rglob(filename))
    if not matches:
        raise HTTPException(status_code=404, detail="Output file not found")
    file_path = matches[0]
    media = "text/plain" if file_path.suffix.lower() in {".asc", ".csv", ".txt", ".json"} else None
    return FileResponse(file_path, filename=file_path.name, media_type=media)


@app.get("/api/jobs/{job_id}/outputs/{filename}/text")
def get_output_text(job_id: str, filename: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    run_dir = Path(job["run_dir"])
    matches = list(run_dir.rglob(filename))
    if not matches:
        raise HTTPException(status_code=404, detail="Output file not found")
    file_path = matches[0]
    return PlainTextResponse(file_path.read_text(encoding="utf-8"))
