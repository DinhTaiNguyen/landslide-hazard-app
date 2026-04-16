from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/sensors", tags=["sensors"])

DATA_DIR = Path("sensor_data")
DATA_DIR.mkdir(exist_ok=True)
LATEST_FILE = DATA_DIR / "latest.json"
HISTORY_FILE = DATA_DIR / "history.jsonl"


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


@router.post("/upload")
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


@router.get("/latest")
def get_latest():
    return {"status": "ok", "data": _read_latest()}


@router.get("/history")
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


@router.get("/health")
def sensors_health():
    return {
        "status": "ok",
        "service": "sensor-routes",
        "time": datetime.now(timezone.utc).isoformat(),
        "latest_file_exists": LATEST_FILE.exists(),
        "history_file_exists": HISTORY_FILE.exists(),
    }
