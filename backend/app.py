from __future__ import annotations

import json
import os
import shutil
import threading
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from form_runner import FormSettings, InputPaths, SoilParam, run_form

BASE_DIR = Path(__file__).resolve().parent
RUNS_DIR = BASE_DIR / "runs"
RUNS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Landslide Hazard FORM Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "time": now_iso()}


@app.post("/api/form/run")
async def start_form_run(
    settings_json: str = Form(...),
    slope_file: UploadFile = File(...),
    soiltype_file: UploadFile = File(...),
    soilthickness_file: UploadFile = File(...),
    dem_file: UploadFile | None = File(None),
    pwp_files: List[UploadFile] = File(...),
):
    job_id = uuid.uuid4().hex[:12]
    run_dir = RUNS_DIR / f"run_{job_id}"
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
        name = os.path.basename(upload.filename)
        if not name:
            continue
        save_upload(upload, pwp_dir / name)

    JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "logs": [f"[{now_iso()}] Job created", f"[{now_iso()}] Uploaded {len(pwp_files)} PWP files"],
        "run_dir": str(run_dir),
        "outputs": {},
        "summary": {},
        "error": None,
    }

    def log(message: str) -> None:
        JOBS[job_id]["logs"].append(f"[{now_iso()}] {message}")
        JOBS[job_id]["updated_at"] = now_iso()

    def worker() -> None:
        try:
            JOBS[job_id]["status"] = "running"
            log("FORM job started")
            result = run_form(inputs=inputs, settings=settings, output_dir=output_dir, log=log)
            JOBS[job_id]["outputs"] = {name: f"/api/jobs/{job_id}/download/{name}" for name in result.outputs.keys()}
            JOBS[job_id]["summary"] = result.summary
            JOBS[job_id]["status"] = "completed"
            log("FORM job completed successfully")
        except Exception as exc:  # noqa: BLE001
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = str(exc)
            log(f"ERROR: {exc}")
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

    file_path = Path(job["run_dir"]) / "outputs" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found")
    return FileResponse(file_path, filename=filename, media_type="text/plain")


@app.get("/api/jobs/{job_id}/outputs/{filename}/text")
def get_output_text(job_id: str, filename: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    file_path = Path(job["run_dir"]) / "outputs" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found")
    return PlainTextResponse(file_path.read_text(encoding="utf-8"))
