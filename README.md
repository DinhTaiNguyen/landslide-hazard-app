# Landslide Hazard App — FORM-enabled restructure

This repo restructures your current single-page prototype into a frontend + backend workflow so the **Run** button can send uploaded files to Python, execute the FORM computation, stream runtime logs back to the UI by polling, and expose the generated ASC result files for map preview and download.

## New repo structure

```text
landslide-hazard-app-restructured/
├─ frontend/
│  ├─ index.html
│  ├─ style.css
│  ├─ script.js
│  └─ images/
│     └─ GeoXPM_logo_3D.png
├─ backend/
│  ├─ app.py
│  ├─ form_runner.py
│  ├─ requirements.txt
│  └─ runs/                # created at runtime
└─ README.md
```

## What changed

- Added **GeoTOP PWP folder upload** on the left panel.
- Added **FORM running** console tab in the center section.
- Added **result layer controls** on the right panel with view + download.
- Switched the FORM execution path from a placeholder button to a real backend API call.
- Converted the original Python script from hardcoded local paths into a reusable backend runner.
- Added job storage under `backend/runs/<job_id>/inputs` and `backend/runs/<job_id>/outputs`.

## Run locally

### 1) Start backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### 2) Start frontend

Use any static file server.

```bash
cd frontend
python -m http.server 5500
```

Open:

```text
http://127.0.0.1:5500
```

Keep backend URL in the UI as:

```text
http://127.0.0.1:8000
```

## Upload workflow

1. Upload `slope.asc`, `soiltype.asc`, and `soilthickness.asc`.
2. Optionally upload DEM for preview.
3. Select the GeoTOP output folder containing the PWP ASC files.
4. Fill the FORM parameters on the right panel.
5. Click **Run**.
6. Watch runtime logs in **FORM running**.
7. When complete, the result layers appear on the right. Default preview is `PoF.asc`.

## Runtime storage

Each run is saved like this:

```text
backend/runs/run_<jobid>/
├─ inputs/
│  ├─ slope.asc
│  ├─ soiltype.asc
│  ├─ soilthickness.asc
│  ├─ dem.asc
│  └─ pwp/
│     ├─ psizL0000N0001.asc
│     ├─ ...
├─ outputs/
│  ├─ PoF.asc
│  ├─ FS_min.asc
│  ├─ FS_min_depth.asc
│  └─ beta.asc
```

## Important deployment note

This architecture is meant for **a real backend host**.
If you deploy only the frontend on a static host, the Python FORM job cannot run there.

Good options:
- frontend: GitHub Pages / Netlify / Vercel
- backend: Render / Railway / VPS / cloud VM / Docker container

## Next improvements

- Add progress percentage based on time-code completion.
- Add zip download for all outputs.
- Add result metadata JSON and run history.
- Add GeoTOP execution endpoint later if you want the site to run GeoTOP itself before FORM.
- Add cleanup policy for old runs.
