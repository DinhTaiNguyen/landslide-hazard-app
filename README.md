
# GeoTOP cloud website starter

This package turns your current UI into a real website that can submit a GeoTOP case folder to a backend, run GeoTOP on Linux, and browse files created under `output-maps/`.

## What this package does

- Keeps your current frontend look and controls.
- Adds **Upload GeoTOP case folder** in the GeoTOP panel.
- Sends the selected folder to a FastAPI backend.
- Rebuilds the case folder on the server with the same structure, for example:

  ```
  zihao_geotop_2/
    geotop.inpts
    meteo/meteo0001
    soil/soil0001
    soil/soil0002
    soil/soil0003
    input_maps/pit.asc
    input_maps/soiltype.asc
  ```

- Runs GeoTOP as:

  ```bash
  /path/to/geotop <case_folder>
  ```

- Stores logs and output files in `runtime/jobs/<job_id>/...`
- Lets the frontend list files found under `output-maps/`, load ASC outputs onto the map, or download them.

## Recommended cloud setup

Use **one Ubuntu VPS** first.

- Put this project on the VPS.
- Build and run it with Docker Compose.
- Point your domain to the VPS.
- Later, add a queue/worker if many users run jobs at once.

## Why not GitHub Pages alone?

GitHub Pages only hosts static HTML/CSS/JS. It cannot execute GeoTOP or any server-side process. Use GitHub for the repository, and use a VPS/cloud VM for the running website.

## Quick start with Docker

```bash
cd geotop_cloud_app
docker compose up --build
```

Then open:

- `http://YOUR_SERVER_IP:8000`
- API health check: `http://YOUR_SERVER_IP:8000/api/health`

## Important note about GeoTOP compilation

The Dockerfile tries to clone the official GeoTOP repository, check out `v3.0`, and compile it with CMake.

If that build fails on your server, do this instead:

1. Build GeoTOP directly on Ubuntu with:
   ```bash
   ./scripts/install_geotop_host.sh
   ```
2. Edit `docker-compose.yml` and replace:
   ```yaml
   GEOTOP_BIN: /opt/geotop-src/cmake-build/geotop
   ```
   with your real host path, for example:
   ```yaml
   GEOTOP_BIN: /home/ubuntu/geotop/geotop/cmake-build/geotop
   ```
3. Run the backend without containerizing GeoTOP, or rebuild the container and mount that path.

## How to use the website

### Best method: upload the whole GeoTOP case folder

In the GeoTOP panel, click **Upload GeoTOP case folder** and choose the folder that contains:

- `geotop.inpts`
- `meteo/`
- `soil/`
- `input_maps/`

This is the safest method because the backend recreates the same folder structure you already use locally.

### Run button

Click **Run GeoTOP to calculate pore-water pressure (PWP)**.

The backend will:

1. create a job folder
2. rebuild the uploaded case
3. run GeoTOP against that case directory
4. stream status back to the frontend
5. expose files found in `output-maps/`

## API endpoints

- `POST /api/geotop/jobs` — upload a GeoTOP case and create a job
- `GET /api/geotop/jobs/{job_id}` — poll job status
- `GET /api/geotop/jobs/{job_id}/outputs` — list `output-maps` files
- `GET /api/geotop/jobs/{job_id}/outputs/{rel_path}` — download an output file

## Scaling later

For many users, change the execution model from simple background threads to a real queue.

Typical next steps:

- Redis + RQ/Celery worker
- one web service + one or more worker services
- per-user quotas
- job cleanup policy
- separate object storage for large outputs
