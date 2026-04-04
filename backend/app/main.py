
import json
import os
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = BASE_DIR / "frontend"
JOBS_DIR = Path(os.getenv("JOBS_DIR", BASE_DIR / "runtime" / "jobs"))
GEOTOP_BIN = os.getenv("GEOTOP_BIN", "/opt/geotop/cmake-build/geotop")
POLL_LINES = int(os.getenv("POLL_LINES", "40"))

JOBS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="GeoTOP Web Runner")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

job_states = {}
job_lock = threading.Lock()


def tail_text(path: Path, lines: int = POLL_LINES) -> str:
    if not path.exists():
        return ""
    content = path.read_text(errors="ignore").splitlines()
    return "\n".join(content[-lines:])


def set_job_state(job_id: str, **kwargs):
    with job_lock:
        state = job_states.setdefault(job_id, {})
        state.update(kwargs)
        state.setdefault("job_id", job_id)


def get_job_state(job_id: str):
    with job_lock:
        return dict(job_states.get(job_id, {}))


def write_upload(upload: UploadFile, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as f:
        shutil.copyfileobj(upload.file, f)


def resolve_case_root(names: List[str]) -> str:
    if not names:
        return "case"
    first = names[0].replace("\\", "/")
    if "/" in first:
        return first.split("/")[0]
    return "case"


def run_geotop_job(job_id: str, case_dir: Path):
    stdout_path = JOBS_DIR / job_id / "stdout.log"
    stderr_path = JOBS_DIR / job_id / "stderr.log"
    set_job_state(job_id, status="running", case_dir=str(case_dir))

    if not Path(GEOTOP_BIN).exists():
        stderr_path.write_text(f"GeoTOP binary not found at {GEOTOP_BIN}\n")
        set_job_state(job_id, status="failed", error=f"GeoTOP binary not found at {GEOTOP_BIN}")
        return

    cmd = [GEOTOP_BIN, str(case_dir)]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(case_dir.parent),
            capture_output=True,
            text=True,
            check=False,
        )
        stdout_path.write_text(proc.stdout or "")
        stderr_path.write_text(proc.stderr or "")
        output_maps_dir = case_dir / "output-maps"
        outputs = []
        if output_maps_dir.exists():
            outputs = sorted(str(p.relative_to(case_dir)).replace("\\", "/") for p in output_maps_dir.rglob("*") if p.is_file())
        if proc.returncode == 0:
            set_job_state(job_id, status="completed", returncode=proc.returncode, outputs=outputs)
        else:
            set_job_state(job_id, status="failed", returncode=proc.returncode, outputs=outputs, error="GeoTOP returned non-zero exit code")
    except Exception as exc:
        stderr_path.write_text(str(exc))
        set_job_state(job_id, status="failed", error=str(exc))


@app.get("/api/health")
def health():
    return {"ok": True, "geotop_bin": GEOTOP_BIN, "jobs_dir": str(JOBS_DIR)}


@app.post("/api/geotop/jobs")
async def create_geotop_job(
    case_files: List[UploadFile] = File(default=[]),
    manifest: Optional[str] = Form(default=None),
):
    if not case_files:
        raise HTTPException(status_code=400, detail="No GeoTOP case files were uploaded")

    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    raw_names = [f.filename for f in case_files if f.filename]
    case_root = resolve_case_root(raw_names)
    case_dir = job_dir / case_root
    case_dir.mkdir(parents=True, exist_ok=True)

    uploaded = []
    for upload in case_files:
        rel = (upload.filename or upload.filename or "uploaded_file").replace("\\", "/")
        parts = [p for p in rel.split("/") if p not in ("", ".")]
        if parts and parts[0] == case_root:
            parts = parts[1:]
        if not parts:
            parts = [upload.filename or "uploaded_file"]
        target = case_dir.joinpath(*parts)
        upload.file.seek(0)
        write_upload(upload, target)
        uploaded.append(str(target.relative_to(case_dir)).replace("\\", "/"))

    if manifest:
        try:
            parsed = json.loads(manifest)
        except Exception:
            parsed = {"raw_manifest": manifest}
        (job_dir / "manifest.json").write_text(json.dumps(parsed, indent=2))

    geotop_inpts = case_dir / "geotop.inpts"
    if not geotop_inpts.exists():
        raise HTTPException(status_code=400, detail="Uploaded case folder does not contain geotop.inpts")

    set_job_state(job_id, status="queued", case_dir=str(case_dir), uploaded=uploaded)
    thread = threading.Thread(target=run_geotop_job, args=(job_id, case_dir), daemon=True)
    thread.start()

    return {"job_id": job_id, "status": "queued", "case_root": case_root}


@app.get("/api/geotop/jobs/{job_id}")
def get_geotop_job(job_id: str):
    state = get_job_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    stdout_path = JOBS_DIR / job_id / "stdout.log"
    stderr_path = JOBS_DIR / job_id / "stderr.log"
    state["stdout_tail"] = tail_text(stdout_path)
    state["stderr_tail"] = tail_text(stderr_path)
    return state


@app.get("/api/geotop/jobs/{job_id}/outputs")
def list_outputs(job_id: str):
    state = get_job_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    outputs = state.get("outputs", [])
    return {"job_id": job_id, "files": outputs}


@app.get("/api/geotop/jobs/{job_id}/outputs/{rel_path:path}")
def fetch_output(job_id: str, rel_path: str, download: int = Query(default=0)):
    state = get_job_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job not found")
    case_dir = Path(state.get("case_dir", ""))
    if not case_dir.exists():
        raise HTTPException(status_code=404, detail="Case directory missing")
    safe = Path(rel_path)
    target = (case_dir / safe).resolve()
    try:
        target.relative_to(case_dir.resolve())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Output file not found")
    media_type = "text/plain" if target.suffix.lower() == ".asc" else None
    filename = target.name if download else None
    return FileResponse(target, media_type=media_type, filename=filename)


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
