import asyncio
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

APP_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = Path(os.getenv('GEOTOP_DATA_ROOT', APP_ROOT / 'runtime'))
JOBS_ROOT = DATA_ROOT / 'jobs'
JOBS_ROOT.mkdir(parents=True, exist_ok=True)

# Edit this to match how GeoTOP is launched on your Ubuntu machine.
# Examples:
#   GEOTOP_COMMAND="/opt/geotop/geotop"
#   GEOTOP_COMMAND="/usr/local/bin/geotop"
GEOTOP_COMMAND = os.getenv('GEOTOP_COMMAND', '/opt/geotop/geotop')
# Optional extra flags, split by spaces.
GEOTOP_EXTRA_ARGS = os.getenv('GEOTOP_EXTRA_ARGS', '')
# File name used for the uploaded GeoTOP config inside each job folder.
GEOTOP_CONFIG_NAME = os.getenv('GEOTOP_CONFIG_NAME', 'geotop.inpts')

app = FastAPI(title='GeoTOP Web API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


class JobInfo(BaseModel):
    job_id: str
    status: str
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    command: Optional[List[str]] = None
    stdout_path: Optional[str] = None
    stderr_path: Optional[str] = None
    outputs_dir: Optional[str] = None
    error: Optional[str] = None


JOBS: Dict[str, JobInfo] = {}
JOB_LOCK = asyncio.Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_join_job(job_id: str, *parts: str) -> Path:
    job_dir = JOBS_ROOT / job_id
    return job_dir.joinpath(*parts)


def read_tail(path: Optional[str], limit: int = 4000) -> str:
    if not path:
        return ''
    p = Path(path)
    if not p.exists():
        return ''
    text = p.read_text(errors='ignore')
    return text[-limit:]


def save_upload(upload: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('wb') as f:
        shutil.copyfileobj(upload.file, f)


@app.get('/api/health')
async def health():
    return {'ok': True, 'geotop_command': GEOTOP_COMMAND}


@app.post('/api/geotop/jobs')
async def create_geotop_job(
    geotop_config: UploadFile = File(...),
    uploaded_files: List[UploadFile] = File(default=[]),
    manifest: str = Form(default='{}'),
):
    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS_ROOT / job_id
    inputs_dir = job_dir / 'inputs'
    outputs_dir = job_dir / 'outputs'
    logs_dir = job_dir / 'logs'
    for d in (inputs_dir, outputs_dir, logs_dir):
        d.mkdir(parents=True, exist_ok=True)

    # Save manifest for debugging/reproducibility.
    try:
        manifest_data = json.loads(manifest) if manifest else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f'Invalid manifest JSON: {exc}')

    (job_dir / 'manifest.json').write_text(json.dumps(manifest_data, indent=2))

    # Save primary GeoTOP config with a fixed name unless you change env.
    config_path = inputs_dir / GEOTOP_CONFIG_NAME
    save_upload(geotop_config, config_path)

    # Save all uploaded supplemental files.
    for upload in uploaded_files:
        filename = Path(upload.filename).name
        # filename may contain prefixed folders passed from frontend like rainfall/x.csv
        rel = Path(upload.filename)
        destination = inputs_dir / rel
        save_upload(upload, destination)

    stdout_path = logs_dir / 'stdout.log'
    stderr_path = logs_dir / 'stderr.log'

    extra_args = [arg for arg in GEOTOP_EXTRA_ARGS.split(' ') if arg]
    command = [GEOTOP_COMMAND, str(config_path), *extra_args]

    info = JobInfo(
        job_id=job_id,
        status='queued',
        created_at=utc_now(),
        command=command,
        stdout_path=str(stdout_path),
        stderr_path=str(stderr_path),
        outputs_dir=str(outputs_dir),
    )

    async with JOB_LOCK:
        JOBS[job_id] = info

    asyncio.create_task(run_geotop_job(job_id, job_dir, inputs_dir, outputs_dir, stdout_path, stderr_path, command))

    return JSONResponse({'job_id': job_id, 'status': info.status})


async def run_geotop_job(job_id: str, job_dir: Path, inputs_dir: Path, outputs_dir: Path, stdout_path: Path, stderr_path: Path, command: List[str]):
    async with JOB_LOCK:
        job = JOBS[job_id]
        job.status = 'running'
        job.started_at = utc_now()
        JOBS[job_id] = job

    env = os.environ.copy()
    env['GEOTOP_OUTPUT_DIR'] = str(outputs_dir)

    stdout_f = stdout_path.open('wb')
    stderr_f = stderr_path.open('wb')

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(inputs_dir),
            stdout=stdout_f,
            stderr=stderr_f,
            env=env,
        )
        return_code = await process.wait()

        async with JOB_LOCK:
            job = JOBS[job_id]
            if return_code == 0:
                job.status = 'completed'
            else:
                job.status = 'failed'
                job.error = f'GeoTOP exited with code {return_code}'
            job.finished_at = utc_now()
            JOBS[job_id] = job
    except Exception as exc:
        async with JOB_LOCK:
            job = JOBS[job_id]
            job.status = 'failed'
            job.error = str(exc)
            job.finished_at = utc_now()
            JOBS[job_id] = job
    finally:
        stdout_f.close()
        stderr_f.close()


@app.get('/api/geotop/jobs/{job_id}')
async def get_job(job_id: str):
    async with JOB_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail='Job not found')

    payload = job.model_dump()
    payload['stdout_tail'] = read_tail(job.stdout_path)
    payload['stderr_tail'] = read_tail(job.stderr_path)
    return JSONResponse(payload)


@app.get('/api/geotop/jobs/{job_id}/logs')
async def get_job_logs(job_id: str):
    async with JOB_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail='Job not found')
    return {
        'job_id': job_id,
        'stdout': read_tail(job.stdout_path, limit=20000),
        'stderr': read_tail(job.stderr_path, limit=20000),
    }
