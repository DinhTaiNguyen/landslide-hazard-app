# Landslide Hazard App

This repo is split into a static frontend and a Python backend.

## Why the old "Backend URL" showed `Not reachable`

The earlier version prefilled the backend as `http://127.0.0.1:8000`. That only works on your own computer.
When the frontend is published online, every visitor's browser interprets `127.0.0.1` as **their own machine**, not your server, so the check fails.

A second common problem is **mixed content**: if the frontend is opened over `https`, browsers block calls to a backend that still uses `http`.

## What changed in this version

- The frontend no longer hardcodes `127.0.0.1` for online use.
- `config.js` is used to store the deployed backend URL.
- The backend URL entered in the UI is saved in `localStorage`.
- The frontend now warns when the backend is empty or when HTTPS frontend tries to call an HTTP backend.
- A `render.yaml` file is included for easy Render deployment.
- The backend CORS configuration was simplified for browser-safe public access.

## Repo structure

```
index.html
style.css
script.js
config.js
images/
backend/
frontend/
render.yaml
```

Use the root `index.html` for GitHub Pages.

## Deploy online

### 1. Deploy backend to Render

This repo already includes `render.yaml`.

On Render:
1. Create a new Web Service from your GitHub repo.
2. Render should detect `render.yaml`.
3. Deploy.
4. After deploy, copy the backend URL, for example:
   `https://landslide-hazard-form-backend.onrender.com`

You can test it by opening:
`https://your-backend-url/api/health`

### 2. Set frontend config

Edit `config.js` in the repo root to:

```js
window.APP_CONFIG = window.APP_CONFIG || {
  API_BASE_URL: 'https://your-backend-url.onrender.com'
};
```

### 3. Deploy frontend to GitHub Pages

Publish from the repository root so that `index.html` is served directly.

## Local run

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
Open the root `index.html`, or run a static server from the repo root.

## Runtime storage

Each FORM run is stored under:

```
backend/runs/run_<jobid>/inputs
backend/runs/run_<jobid>/outputs
```

Uploaded files are saved in `inputs/`. Generated ASC maps are saved in `outputs/` and exposed through the API so users can view and download them.
