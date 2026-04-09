# Landslide Hazard App

This package is prepared for **Google Cloud** deployment.

## What is included

1. **Backend**: FastAPI service for FORM + Machine Learning
2. **Frontend**: static HTML/CSS/JS interface
3. **Google Cloud deployment files**
   - `cloudbuild.yaml`
   - `backend/Dockerfile`
   - `deploy-google-cloud-backend.sh`
   - `deploy-google-cloud-backend.bat`
   - `GOOGLE_CLOUD_STEP_BY_STEP.md`

## Recommended architecture

- **Backend API** -> Google Cloud Run
- **Frontend website** -> GitHub Pages or Google Cloud Storage static hosting

This is the simplest setup because your UI is static, while the FORM/ML backend needs a Python server.

## Quick summary

1. Deploy `backend/` to **Cloud Run**
2. Copy the Cloud Run service URL
3. Paste that URL into `config.js` and `frontend/config.js`
4. Upload the frontend to GitHub Pages or Cloud Storage

Full instructions are in `GOOGLE_CLOUD_STEP_BY_STEP.md`.
