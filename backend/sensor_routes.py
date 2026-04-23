from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(tags=["sensors", "monitoring"])

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "sensor_data"
DATA_DIR.mkdir(exist_ok=True)
LATEST_FILE = DATA_DIR / "latest.json"
HISTORY_FILE = DATA_DIR / "history.jsonl"

MONITORING_DIR = BASE_DIR / "monitoring_data"
MONITORING_DIR.mkdir(exist_ok=True)
MONITORING_IMAGES_DIR = MONITORING_DIR / "images"
MONITORING_META_DIR = MONITORING_DIR / "metadata"
MONITORING_IMAGES_DIR.mkdir(exist_ok=True)
MONITORING_META_DIR.mkdir(exist_ok=True)
MONITORING_INDEX_FILE = MONITORING_DIR / "index.jsonl"
API_KEY = os.getenv("MONITORING_API_KEY", "").strip()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")


class SensorReading(BaseModel):
    sensor_id: str = Field(..., examples=["pwp_01"])
    sensor_type: str = Field(..., examples=["pore_water_pressure"])
    timestamp: datetime
    value: float
    unit: str = Field(..., examples=["kPa"])
    x: Optional[float] = None
    y: Optional[float] = None
    status: str = "ok"
    source: str = "unknown"


def _read_latest() -> dict:
    if not LATEST_FILE.exists():
        return {}
    try:
        return json.loads(LATEST_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read latest sensor data: {exc}") from exc


def _safe_name(value: str, fallback: str = "unknown") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", (value or "").strip())
    return cleaned[:120] or fallback


def _monitoring_index_tail(device_id: Optional[str], limit: int) -> list[dict]:
    if not MONITORING_INDEX_FILE.exists():
        return []
    rows = []
    try:
        with MONITORING_INDEX_FILE.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if device_id and item.get("device_id") != device_id:
                    continue
                rows.append(item)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read monitoring history: {exc}") from exc
    return rows[-limit:]


def _base_url_from_request(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


def _image_url(request: Request, device_safe: str, filename: str) -> str:
    return f"{_base_url_from_request(request)}/api/monitoring/image/{device_safe}/{filename}"


@router.post("/api/sensors/upload")
def upload_sensor(reading: SensorReading):
    record = reading.model_dump()
    record["timestamp"] = reading.timestamp.astimezone(timezone.utc).isoformat()
    record["received_at"] = datetime.now(timezone.utc).isoformat()

    latest = _read_latest()
    latest[reading.sensor_id] = record
    try:
        LATEST_FILE.write_text(json.dumps(latest, indent=2), encoding="utf-8")
        with HISTORY_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to store sensor data: {exc}") from exc

    return {
        "status": "ok",
        "message": "Sensor reading stored",
        "sensor_id": reading.sensor_id,
        "stored_timestamp": record["timestamp"],
    }


@router.get("/api/sensors/latest")
def get_latest():
    return {"status": "ok", "data": _read_latest()}


@router.get("/api/sensors/history")
def get_history(
    sensor_id: str = Query(..., description="Sensor ID to filter"),
    limit: int = Query(100, ge=1, le=5000),
):
    if not HISTORY_FILE.exists():
        return {"status": "ok", "data": []}

    rows = []
    try:
        with HISTORY_FILE.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if item.get("sensor_id") == sensor_id:
                    rows.append(item)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read sensor history: {exc}") from exc

    return {"status": "ok", "data": rows[-limit:]}


@router.get("/api/sensors/health")
def sensors_health():
    return {
        "status": "ok",
        "service": "sensor-routes",
        "time": datetime.now(timezone.utc).isoformat(),
        "latest_file_exists": LATEST_FILE.exists(),
        "history_file_exists": HISTORY_FILE.exists(),
        "monitoring_index_exists": MONITORING_INDEX_FILE.exists(),
    }


@router.post("/api/monitoring/upload-image")
async def upload_monitoring_image(
    request: Request,
    file: UploadFile = File(...),
    device_id: str = Form(...),
    captured_at_utc: str = Form(...),
    source: str = Form("pc_camera"),
):
    if API_KEY:
        incoming_key = request.headers.get("x-api-key", "")
        if incoming_key != API_KEY:
            raise HTTPException(status_code=401, detail="Invalid API key")

    content_type = (file.content_type or "").lower()
    if content_type not in {"image/jpeg", "image/jpg", "image/png"}:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {file.content_type}")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    ext = ".jpg" if content_type in {"image/jpeg", "image/jpg"} else ".png"
    device_safe = _safe_name(device_id, "device")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    uid = uuid.uuid4().hex[:8]
    safe_name = f"{device_safe}_{stamp}_{uid}{ext}"

    device_img_dir = MONITORING_IMAGES_DIR / device_safe
    device_meta_dir = MONITORING_META_DIR / device_safe
    device_img_dir.mkdir(parents=True, exist_ok=True)
    device_meta_dir.mkdir(parents=True, exist_ok=True)

    image_path = device_img_dir / safe_name
    meta_path = device_meta_dir / f"{Path(safe_name).stem}.json"
    latest_name = "latest.jpg" if ext == ".jpg" else "latest.png"
    latest_path = device_img_dir / latest_name

    try:
        image_path.write_bytes(payload)
        latest_path.write_bytes(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded image: {exc}") from exc

    metadata = {
        "status": "ok",
        "device_id": device_id,
        "captured_at_utc": captured_at_utc,
        "received_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "original_filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(payload),
        "saved_as": safe_name,
        "image_path": str(image_path.relative_to(BASE_DIR)),
        "latest_path": str(latest_path.relative_to(BASE_DIR)),
        "image_url": _image_url(request, device_safe, safe_name),
        "latest_image_url": _image_url(request, device_safe, latest_name),
        "client_host": request.client.host if request.client else None,
    }

    try:
        meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        with MONITORING_INDEX_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(metadata) + "\n")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save metadata: {exc}") from exc

    return metadata




@router.get("/api/monitoring/devices")
def list_monitoring_devices():
    devices = []
    seen = set()
    if MONITORING_INDEX_FILE.exists():
        try:
            with MONITORING_INDEX_FILE.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    device_id = str(item.get("device_id") or "").strip()
                    if device_id and device_id not in seen:
                        seen.add(device_id)
                        devices.append(device_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to list monitoring devices: {exc}") from exc
    for path in MONITORING_IMAGES_DIR.iterdir() if MONITORING_IMAGES_DIR.exists() else []:
        if path.is_dir() and path.name not in seen:
            seen.add(path.name)
            devices.append(path.name)
    if not devices:
        devices = ["pc-camera-01"]
    devices = sorted(devices)
    return {"status": "ok", "devices": devices}

@router.get("/api/monitoring/image/{device_id}/{filename}")
def get_monitoring_image(device_id: str, filename: str):
    device_safe = _safe_name(device_id, "device")
    safe_filename = _safe_name(filename, "image.jpg")
    image_path = MONITORING_IMAGES_DIR / device_safe / safe_filename
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    media_type = "image/png" if image_path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(image_path, media_type=media_type)


@router.get("/api/monitoring/latest")
def get_latest_monitoring_image(request: Request, device_id: str = Query(...)):
    device_safe = _safe_name(device_id, "device")
    rows = _monitoring_index_tail(device_id, 200)
    latest_meta = rows[-1] if rows else None
    if not latest_meta:
        return {
            "status": "ok",
            "device_id": device_id,
            "latest_exists": False,
            "timestamp": None,
            "image_url": None,
            "metadata": None,
        }

    latest_filename = Path(latest_meta.get("latest_path", "latest.jpg")).name
    return {
        "status": "ok",
        "device_id": device_id,
        "latest_exists": True,
        "timestamp": latest_meta.get("captured_at_utc") or latest_meta.get("received_at_utc"),
        "image_url": _image_url(request, device_safe, latest_filename),
        "metadata": latest_meta,
    }


@router.get("/api/monitoring/history")
def get_monitoring_history(request: Request, device_id: str = Query(...), limit: int = Query(100, ge=1, le=5000)):
    device_safe = _safe_name(device_id, "device")
    rows = _monitoring_index_tail(device_id, limit)
    images = []
    for item in rows:
        saved_as = item.get("saved_as")
        if not saved_as:
            continue
        images.append({
            "timestamp": item.get("captured_at_utc") or item.get("received_at_utc"),
            "image_url": _image_url(request, device_safe, saved_as),
            "saved_as": saved_as,
            "content_type": item.get("content_type"),
            "size_bytes": item.get("size_bytes"),
        })
    return {"status": "ok", "device_id": device_id, "images": images}
