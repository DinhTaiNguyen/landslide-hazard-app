# Google Cloud step-by-step setup

This version adds **chunked uploads** so the frontend can send large inputs to Google Cloud in many small requests instead of one giant POST. That avoids the Cloud Run 32 MiB HTTP/1 request limit per request.

## Recommended architecture

- **Frontend**: Vercel, GitHub Pages, or Google Cloud Storage
- **Backend**: Cloud Run
- **Upload bucket**: Cloud Storage bucket set in `GCS_UPLOAD_BUCKET`

The frontend now uploads every file in small chunks to the backend. The backend stores the chunks in **Cloud Storage** and composes them into final files before starting FORM or ML preparation.

## 1. Create a Cloud Storage bucket

Create one bucket for uploaded inputs, for example:

```bash
gcloud storage buckets create gs://YOUR_UPLOAD_BUCKET --location=australia-southeast1
```

## 2. Give the Cloud Run service account access to the bucket

Grant this role on the upload bucket to the Cloud Run service account:

- `Storage Object Admin`

This is needed so the backend can upload chunks, compose them, download them for processing, and clean up chunk parts.

## 3. Deploy the backend

```bash
gcloud run deploy landslide-hazard-api   --source ./backend   --region australia-southeast1   --allow-unauthenticated   --memory 4Gi   --cpu 2   --timeout 3600   --max-instances 2   --concurrency 1   --set-env-vars CORS_ALLOW_ORIGINS=https://YOUR_FRONTEND_DOMAIN,GCS_UPLOAD_BUCKET=YOUR_UPLOAD_BUCKET
```

Suggested settings:

- **memory**: 4 GiB
- **cpu**: 2
- **timeout**: 3600 seconds
- **concurrency**: 1

## 4. Verify the backend

Open:

```text
https://YOUR_CLOUD_RUN_URL/api/health
```

You should see JSON with:

- `status: ok`
- `chunk_upload_backend: gcs`
- your bucket name in `gcs_upload_bucket`

If `chunk_upload_backend` says `local`, the bucket environment variable was not set correctly.

## 5. Point the frontend to Cloud Run

Edit both files if both are used in your repo:

- `config.js`
- `frontend/config.js`

Set:

```js
window.APP_CONFIG = window.APP_CONFIG || {
  API_BASE_URL: 'https://YOUR_CLOUD_RUN_URL'
};
```

## 6. Deploy the frontend

You can deploy the frontend on Vercel, GitHub Pages, or Google Cloud Storage.

For Vercel:

- set the **Root Directory** to the frontend folder you want to deploy
- Framework preset: **Other**
- no build command needed for this static frontend

## 7. How large uploads work in this version

- browser splits files into small chunks
- browser sends chunks to `/api/uploads/chunk`
- backend stores chunk objects in Cloud Storage
- browser calls `/api/uploads/finalize`
- backend composes chunk objects into final files in the bucket
- browser sends a small manifest to `/api/form/run` or `/api/ml/prepare`
- backend downloads the finalized files from Cloud Storage and runs the job

## 8. Important limits

This avoids the single-request 32 MiB limit, but very large total uploads will still take time and storage. Keep `concurrency=1` for heavy jobs.

## 9. Files changed in this package

- `backend/app.py` now supports chunk upload, Cloud Storage-backed upload finalization, and manifest-driven FORM / ML prepare runs
- `backend/requirements.txt` now includes `google-cloud-storage`
- `frontend/script.js` uploads files in chunks before starting FORM or ML prepare
