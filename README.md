# Landslide Hazard App - Online FORM Workflow

This repo is split into two parts:

- `frontend/` -> static website UI
- `backend/` -> FastAPI service that receives uploaded files, runs the Python FORM workflow, stores outputs, and serves downloadable result maps

## What changed in this version

- GeoTOP PWP folder upload was moved into the **FORM panel**.
- Clicking **Run** uploads the current inputs to the backend and starts the Python FORM workflow.
- Runtime logs appear in the **FORM running** tab.
- Generated outputs are written as:
  - `PoF.asc`
  - `FS_min.asc`
  - `FS_min_depth.asc`
  - `beta.asc`
- In the FORM panel, each result can be turned on/off and downloaded.
- Default visible result is `PoF.asc`.

## Folder structure

```text
landslide-hazard-app-restructured/
  frontend/
    index.html
    style.css
    script.js
    images/
      GeoXPM_logo_3D.png
  backend/
    app.py
    form_runner.py
    requirements.txt
    runs/                # created automatically at runtime
```

## Local run

### Backend

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

### Frontend

```bash
cd frontend
python -m http.server 5500
```

Open:
- frontend: `http://127.0.0.1:5500`
- backend: `http://127.0.0.1:8000`

## How uploaded data is stored

Each run gets its own folder:

```text
backend/runs/run_<job_id>/
  inputs/
    slope.asc
    soiltype.asc
    soilthickness.asc
    dem.asc               # optional
    pwp/
      psizL0000N0001.asc
      ...
  outputs/
    PoF.asc
    FS_min.asc
    FS_min_depth.asc
    beta.asc
```

This makes it easy to:
- keep each website run separate
- debug failed runs
- allow users to download generated files after completion

## Online deployment recommendation

### Frontend online
Use **GitHub Pages** for `frontend/`.

1. Push this repo to GitHub.
2. Put the website files from `frontend/` on the branch you want to publish.
3. In GitHub repo settings, enable **Pages** and publish from the folder or branch you choose.
4. In the website UI, set **Backend URL** to your deployed backend URL.

### Backend online
Use **Render**, **Railway**, or a VPS.

Example for Render:
1. Create a new web service.
2. Point it to the `backend/` folder.
3. Build command:
   ```bash
   pip install -r requirements.txt
   ```
4. Start command:
   ```bash
   uvicorn app:app --host 0.0.0.0 --port $PORT
   ```

Because the backend stores uploaded files and generated outputs on disk, the hosting platform must support writable local storage during runtime. For long-term persistence, later you can move storage to S3, Cloudflare R2, or another object store.

## Important note

GitHub Pages is static hosting only. It cannot execute your Python FORM code by itself. That is why the FORM run must go to the backend.
