# GeoTOP web starter for your landslide app

This starter keeps your current frontend and adds a FastAPI backend + Docker Compose so the **Run GeoTOP** button can submit a real backend job.

## Recommended folder structure

```text
geotop_webapp_starter/
  frontend/public/
    index.html
    style.css
    script.js
    images/
  backend/
    Dockerfile
    requirements.txt
    app/main.py
  nginx/default.conf
  runtime/jobs/
  docker-compose.yml
  .env.example
```

## What this starter already does

- serves your website with Nginx
- proxies `/api/*` to FastAPI
- lets the frontend upload the GeoTOP configuration plus all other uploaded files to the backend
- creates a job folder per run under `runtime/jobs/<job_id>/`
- launches GeoTOP as a background process
- stores stdout/stderr logs
- lets the frontend poll job status

## What you still must adapt

### 1. GeoTOP executable path
Edit `.env` from `.env.example` and set:

```env
GEOTOP_COMMAND=/absolute/path/to/your/geotop
```

### 2. GeoTOP command style
This starter currently runs:

```bash
$GEOTOP_COMMAND inputs/geotop.inpts
```

If your local Ubuntu command is different, edit `backend/app/main.py` in the `command = [...]` line.

### 3. GeoTOP input naming
The uploaded main configuration is saved as `inputs/geotop.inpts` by default. If your real config file must have another name, set:

```env
GEOTOP_CONFIG_NAME=your_real_file_name_here
```

### 4. Supplementary files
The frontend sends all uploaded web files into the backend job folder under subfolders like:

- `inputs/raster_maps/...`
- `inputs/rainfall/...`
- `inputs/soil_properties/...`
- `inputs/other_maps/...`

If your GeoTOP config expects exact relative file names, make sure the uploaded names match, or adjust the backend save logic.

## Local run on a VPS

```bash
cp .env.example .env
# edit .env
mkdir -p runtime/jobs
sudo docker compose up --build
```

Then open:

- `http://YOUR_SERVER_IP/`

## Suggested next upgrade

For many users later, do **not** keep long-running jobs inside the web API process. Move GeoTOP execution into a queue/worker setup such as Redis + Celery/RQ.
