from __future__ import annotations

import json
import os
import resource
import shutil
import threading
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from google.cloud import storage

from form_runner import FormSettings, InputPaths, SoilParam, run_form
from ml_data_prep import RAINFALL_DEFAULTS, prepare_stage1_dataset
from ml_runner import MLConfig, run_ml_pipeline

BASE_DIR = Path(__file__).resolve().parent
RUNS_DIR = BASE_DIR / "runs"
RUNS_DIR.mkdir(exist_ok=True)
CHUNK_TMP_DIR = RUNS_DIR / "chunk_uploads"
CHUNK_TMP_DIR.mkdir(exist_ok=True)
GCS_UPLOAD_BUCKET = os.getenv("GCS_UPLOAD_BUCKET", "").strip()
_STORAGE_CLIENT = None


def get_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()
    if not raw or raw == "*":
        return ["*"]
    return [item.strip() for item in raw.split(",") if item.strip()]


def get_storage_client() -> storage.Client:
    global _STORAGE_CLIENT
    if _STORAGE_CLIENT is None:
        _STORAGE_CLIENT = storage.Client()
    return _STORAGE_CLIENT


def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def get_memory_usage_mb() -> float:
    usage_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if usage_kb > 10_000_000:
        return round(usage_kb / (1024 * 1024), 2)
    return round(usage_kb / 1024, 2)


app = FastAPI(title="Landslide Hazard Backend")
CORS_ORIGINS = get_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False if CORS_ORIGINS == ["*"] else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: Dict[str, dict] = {}


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


def local_chunk_part_path(upload_id: str, relative_path: str, chunk_index: int) -> Path:
    rel = sanitize_relpath(relative_path)
    return CHUNK_TMP_DIR / upload_id / "parts" / rel.parent / f"{rel.name}.part{chunk_index:05d}"


def local_final_path(upload_id: str, category: str, relative_path: str) -> Path:
    rel = sanitize_relpath(relative_path)
    return CHUNK_TMP_DIR / upload_id / "final" / category / rel


def gcs_chunk_blob_name(upload_id: str, relative_path: str, chunk_index: int) -> str:
    rel = sanitize_relpath(relative_path).as_posix()
    return f"chunk_uploads/{upload_id}/parts/{rel}.part{chunk_index:05d}"


def gcs_final_blob_name(upload_id: str, category: str, relative_path: str) -> str:
    rel = sanitize_relpath(relative_path).as_posix()
    return f"chunk_uploads/{upload_id}/final/{category}/{rel}"


def compose_many(bucket: storage.Bucket, destination_name: str, source_names: List[str]) -> None:
    if not source_names:
        raise ValueError("No source parts supplied for composition")
    current = list(source_names)
    temp_blobs: list[str] = []
    round_idx = 0
    while len(current) > 32:
        next_round: list[str] = []
        for group_idx in range(0, len(current), 32):
            subset = current[group_idx:group_idx + 32]
            tmp_name = f"{destination_name}.compose_tmp_r{round_idx}_{group_idx//32}_{uuid.uuid4().hex[:8]}"
            bucket.blob(tmp_name).compose([bucket.blob(name) for name in subset])
            temp_blobs.append(tmp_name)
            next_round.append(tmp_name)
        current = next_round
        round_idx += 1
    bucket.blob(destination_name).compose([bucket.blob(name) for name in current])
    for name in temp_blobs:
        try:
            bucket.blob(name).delete()
        except Exception:
            pass


def store_chunk(upload_id: str, relative_path: str, chunk_index: int, data: bytes) -> None:
    if GCS_UPLOAD_BUCKET:
        bucket = get_storage_client().bucket(GCS_UPLOAD_BUCKET)
        bucket.blob(gcs_chunk_blob_name(upload_id, relative_path, chunk_index)).upload_from_string(data)
    else:
        path = local_chunk_part_path(upload_id, relative_path, chunk_index)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def finalize_chunked_upload(upload_id: str, category: str, manifest: list[dict]) -> dict:
    files_out = []
    if GCS_UPLOAD_BUCKET:
        bucket = get_storage_client().bucket(GCS_UPLOAD_BUCKET)
        for item in manifest:
            rel = sanitize_relpath(item["relative_path"]).as_posix()
            total_chunks = int(item["total_chunks"])
            parts = [gcs_chunk_blob_name(upload_id, rel, idx) for idx in range(total_chunks)]
            destination_name = gcs_final_blob_name(upload_id, category, rel)
            compose_many(bucket, destination_name, parts)
            for part in parts:
                try:
                    bucket.blob(part).delete()
                except Exception:
                    pass
            files_out.append({
                "relative_path": rel,
                "uri": f"gs://{GCS_UPLOAD_BUCKET}/{destination_name}",
                "size": bucket.blob(destination_name).reload() or None,
            })
        return {"storage": "gcs", "bucket": GCS_UPLOAD_BUCKET, "upload_id": upload_id, "category": category, "files": files_out}
    for item in manifest:
        rel = sanitize_relpath(item["relative_path"]).as_posix()
        total_chunks = int(item["total_chunks"])
        destination = local_final_path(upload_id, category, rel)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as out:
            for idx in range(total_chunks):
                part_path = local_chunk_part_path(upload_id, rel, idx)
                if not part_path.exists():
                    raise FileNotFoundError(f"Missing uploaded chunk: {part_path.name}")
                out.write(part_path.read_bytes())
                part_path.unlink(missing_ok=True)
        files_out.append({"relative_path": rel, "uri": str(destination)})
    return {"storage": "local", "upload_id": upload_id, "category": category, "files": files_out}


def download_uri_to_path(uri: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if uri.startswith("gs://"):
        _, rest = uri.split("gs://", 1)
        bucket_name, blob_name = rest.split("/", 1)
        get_storage_client().bucket(bucket_name).blob(blob_name).download_to_filename(str(destination))
        return destination
    src = Path(uri)
    if not src.exists():
        raise FileNotFoundError(f"Uploaded asset not found: {uri}")
    shutil.copy2(src, destination)
    return destination


def parse_upload_manifest(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid upload_manifest_json: {exc}")


def find_manifest_uri(manifest: dict, prefix: str) -> str | None:
    prefix = prefix.strip("/") + "/"
    for item in manifest.get("files", []):
        rel = item.get("relative_path", "")
        if rel == prefix[:-1] or rel.startswith(prefix):
            return item.get("uri")
    return None


def find_manifest_files(manifest: dict, prefix: str) -> list[dict]:
    prefix = prefix.strip("/") + "/"
    return [item for item in manifest.get("files", []) if str(item.get("relative_path", "")).startswith(prefix)]


@app.get("/")
def root() -> dict:
    return {
        "service": "Landslide Hazard Backend",
        "status": "ok",
        "health": "/api/health",
        "endpoints": [
            "/api/health",
            "/api/uploads/chunk",
            "/api/uploads/finalize",
            "/api/form/run",
            "/api/ml/prepare",
            "/api/ml/run",
        ],
        "cors_allow_origins": CORS_ORIGINS,
        "chunk_upload_backend": "gcs" if GCS_UPLOAD_BUCKET else "local",
        "gcs_upload_bucket": GCS_UPLOAD_BUCKET or None,
    }


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "time": now_iso(),
        "rainfall_defaults": len(RAINFALL_DEFAULTS),
        "chunk_upload_backend": "gcs" if GCS_UPLOAD_BUCKET else "local",
        "gcs_upload_bucket": GCS_UPLOAD_BUCKET or None,
    }


@app.get("/api/rainfall-defaults")
def rainfall_defaults() -> dict:
    return {"defaults": RAINFALL_DEFAULTS}


@app.post("/api/uploads/chunk")
async def upload_chunk(
    upload_id: str = Form(...),
    relative_path: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    chunk_file: UploadFile = File(...),
):
    if chunk_index < 0 or total_chunks < 1 or chunk_index >= total_chunks:
        raise HTTPException(status_code=400, detail="Invalid chunk index or total_chunks")
    try:
        rel = sanitize_relpath(relative_path).as_posix()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    data = await chunk_file.read()
    store_chunk(upload_id, rel, chunk_index, data)
    return {"status": "ok", "upload_id": upload_id, "relative_path": rel, "chunk_index": chunk_index, "total_chunks": total_chunks}


@app.post("/api/uploads/finalize")
async def finalize_upload(upload_id: str = Form(...), category: str = Form(...), manifest_json: str = Form(...)):
    try:
        manifest = json.loads(manifest_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid manifest_json: {exc}")
    if not isinstance(manifest, list) or not manifest:
        raise HTTPException(status_code=400, detail="manifest_json must be a non-empty JSON array")
    try:
        finalized = finalize_chunked_upload(upload_id, category, manifest)
        return finalized
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Finalize failed: {exc}")


@app.post("/api/form/run")
async def start_form_run(
    settings_json: str = Form(...),
    upload_manifest_json: str | None = Form(None),
    slope_file: UploadFile | None = File(None),
    soiltype_file: UploadFile | None = File(None),
    soilthickness_file: UploadFile | None = File(None),
    dem_file: UploadFile | None = File(None),
    pwp_files: Optional[List[UploadFile]] = File(None),
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

    upload_manifest = parse_upload_manifest(upload_manifest_json)

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

    if upload_manifest:
        slope_uri = find_manifest_uri(upload_manifest, "maps/slope.asc")
        soiltype_uri = find_manifest_uri(upload_manifest, "maps/soiltype.asc")
        soilthickness_uri = find_manifest_uri(upload_manifest, "maps/soilthickness.asc")
        dem_uri = find_manifest_uri(upload_manifest, "maps/dem.asc")
        pwp_entries = find_manifest_files(upload_manifest, "pwp")
        if not (slope_uri and soiltype_uri and soilthickness_uri and pwp_entries):
            raise HTTPException(status_code=400, detail="Chunked upload manifest is missing required form files")
        inputs = InputPaths(
            slope_asc=download_uri_to_path(slope_uri, input_dir / "slope.asc"),
            soiltype_asc=download_uri_to_path(soiltype_uri, input_dir / "soiltype.asc"),
            soilthickness_asc=download_uri_to_path(soilthickness_uri, input_dir / "soilthickness.asc"),
            dem_asc=download_uri_to_path(dem_uri, input_dir / "dem.asc") if dem_uri else None,
            pwp_folder=pwp_dir,
        )
        for item in pwp_entries:
            rel = sanitize_relpath(item["relative_path"])
            download_uri_to_path(item["uri"], pwp_dir / rel.name)
        uploaded_pwp_count = len(pwp_entries)
    else:
        if not (slope_file and soiltype_file and soilthickness_file and pwp_files):
            raise HTTPException(status_code=400, detail="Either chunked upload manifest or direct file uploads are required")
        inputs = InputPaths(
            slope_asc=save_upload(slope_file, input_dir / "slope.asc"),
            soiltype_asc=save_upload(soiltype_file, input_dir / "soiltype.asc"),
            soilthickness_asc=save_upload(soilthickness_file, input_dir / "soilthickness.asc"),
            dem_asc=save_upload(dem_file, input_dir / "dem.asc") if dem_file else None,
            pwp_folder=pwp_dir,
        )
        for upload in (pwp_files or []):
            rel = sanitize_relpath(upload.filename)
            save_upload(upload, pwp_dir / rel.name)
        uploaded_pwp_count = len(pwp_files or [])

    job_id = create_job("form", run_dir, extra={"output_dir_name": "outputs"})
    append_log(job_id, f"Prepared {uploaded_pwp_count} PWP files")

    def worker() -> None:
        try:
            JOBS[job_id]["status"] = "running"
            append_log(job_id, "FORM job started")
            result = run_form(inputs=inputs, settings=settings, output_dir=output_dir, log=lambda m: append_log(job_id, m))
            JOBS[job_id]["outputs"] = {name: f"/api/jobs/{job_id}/download/{name}" for name in result.outputs.keys()}
            summary = dict(result.summary)
            summary["memory_used_mb"] = get_memory_usage_mb()
            JOBS[job_id]["summary"] = summary
            JOBS[job_id]["status"] = "completed"
            append_log(job_id, f"FORM job completed successfully | memory used: {summary['memory_used_mb']} MB")
        except MemoryError:
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = "MemoryError"
            append_log(job_id, "ERROR: FORM stopped because the backend ran out of memory.")
            append_log(job_id, f"Current memory: {get_memory_usage_mb()} MB")
            for line in traceback.format_exc().strip().splitlines():
                append_log(job_id, line)
        except Exception as exc:  # noqa: BLE001
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = str(exc)
            append_log(job_id, f"ERROR: {exc}")
            append_log(job_id, f"Current memory: {get_memory_usage_mb()} MB")
            for line in traceback.format_exc().strip().splitlines():
                append_log(job_id, line)
        finally:
            JOBS[job_id]["updated_at"] = now_iso()

    threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id, "status": JOBS[job_id]["status"]}


@app.post("/api/ml/prepare")
async def prepare_ml_dataset(
    rainfall_json: str = Form(...),
    upload_manifest_json: str | None = Form(None),
    map_files: Optional[List[UploadFile]] = File(None),
    form_output_files: Optional[List[UploadFile]] = File(None),
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

    upload_manifest = parse_upload_manifest(upload_manifest_json)
    if upload_manifest:
        map_entries = find_manifest_files(upload_manifest, "maps")
        form_entries = find_manifest_files(upload_manifest, "form_outputs")
        if not map_entries or not form_entries:
            raise HTTPException(status_code=400, detail="Chunked upload manifest is missing maps or FORM outputs")
        for item in map_entries:
            rel = sanitize_relpath(item["relative_path"])
            download_uri_to_path(item["uri"], maps_dir / Path(*rel.parts[1:]))
        for item in form_entries:
            rel = sanitize_relpath(item["relative_path"])
            download_uri_to_path(item["uri"], form_dir / Path(*rel.parts[1:]))
        map_count = len(map_entries)
        form_count = len(form_entries)
    else:
        if not map_files or not form_output_files:
            raise HTTPException(status_code=400, detail="Either chunked upload manifest or direct files are required")
        for upload in map_files:
            rel = sanitize_relpath(upload.filename)
            save_upload(upload, maps_dir / rel.name)
        for upload in form_output_files:
            rel = sanitize_relpath(upload.filename)
            save_upload(upload, form_dir / rel)
        map_count = len(map_files)
        form_count = len(form_output_files)

    job_id = create_job("ml_prepare", run_dir, extra={"output_dir_name": "outputs"})
    append_log(job_id, f"Prepared {map_count} map files and {form_count} FORM files")

    def worker() -> None:
        try:
            JOBS[job_id]["status"] = "running"
            append_log(job_id, "Machine learning data preparation started")
            result = prepare_stage1_dataset(maps_dir, form_dir, rainfall_by_event, output_dir, log=lambda m: append_log(job_id, m))
            JOBS[job_id]["outputs"] = {
                result.dataset_csv.name: f"/api/jobs/{job_id}/download/{result.dataset_csv.name}",
                result.preview_csv.name: f"/api/jobs/{job_id}/download/{result.preview_csv.name}",
            }
            summary = dict(result.summary)
            summary["memory_used_mb"] = get_memory_usage_mb()
            JOBS[job_id]["summary"] = summary
            JOBS[job_id]["detected_maps"] = result.detected_maps
            JOBS[job_id]["detected_events"] = result.detected_events
            JOBS[job_id]["dataset_csv"] = str(result.dataset_csv)
            JOBS[job_id]["reference_asc"] = str((maps_dir / "pit.asc") if (maps_dir / "pit.asc").exists() else next(maps_dir.glob("*.asc")))
            JOBS[job_id]["status"] = "completed"
            append_log(job_id, f"Machine learning data preparation completed | memory used: {JOBS[job_id]['summary']['memory_used_mb']} MB")
        except Exception as exc:  # noqa: BLE001
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = str(exc)
            append_log(job_id, f"ERROR: {exc}")
            append_log(job_id, f"Current memory: {get_memory_usage_mb()} MB")
            for line in traceback.format_exc().strip().splitlines():
                append_log(job_id, line)
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
        stage1_train_events=[str(x) for x in payload.get("stage1_train_events", [])],
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
            dataset_csv_path = Path(prep_job["dataset_csv"])
            result = run_ml_pipeline(
                dataset_csv=dataset_csv_path,
                reference_asc=Path(prep_job["reference_asc"]),
                config=config,
                output_dir=output_dir,
                label_asc=label_path,
                log=lambda m: append_log(job_id, m),
            )
            if dataset_csv_path.exists():
                try:
                    dataset_csv_path.unlink()
                    append_log(job_id, "Removed temporary stage1_base_dataset.csv after ML load to save storage")
                except Exception:
                    pass
            JOBS[job_id]["outputs"] = {name: f"/api/jobs/{job_id}/download/{name}" for name in result.output_files.keys()}
            JOBS[job_id]["plots"] = {name: f"/api/jobs/{job_id}/download/{name}" for name in result.plot_files.keys()}
            summary = dict(result.summary)
            summary["memory_used_mb"] = get_memory_usage_mb()
            JOBS[job_id]["summary"] = summary
            JOBS[job_id]["status"] = "completed"
            append_log(job_id, f"Machine learning training completed | memory used: {summary['memory_used_mb']} MB")
        except Exception as exc:  # noqa: BLE001
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = str(exc)
            append_log(job_id, f"ERROR: {exc}")
            append_log(job_id, f"Current memory: {get_memory_usage_mb()} MB")
            for line in traceback.format_exc().strip().splitlines():
                append_log(job_id, line)
        finally:
            JOBS[job_id]["updated_at"] = now_iso()

    threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id, "status": JOBS[job_id]["status"]}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
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
    output_dir = run_dir / job.get("output_dir_name", "outputs")
    file_path = output_dir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found")
    return FileResponse(file_path)


@app.get("/api/jobs/{job_id}/logs.txt")
def download_logs(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return PlainTextResponse("\n".join(job["logs"]))
