# Landslide hazard app - Google Cloud chunk-upload version

This package is prepared for **Cloud Run + Cloud Storage**.

## Main change

The frontend no longer sends all files to `/api/form/run` or `/api/ml/prepare` in one request.
Instead, it uploads them in chunks using:

- `/api/uploads/chunk`
- `/api/uploads/finalize`

Then it sends only a small upload manifest to start the job.

## Required environment variables

- `CORS_ALLOW_ORIGINS`
- `GCS_UPLOAD_BUCKET`

See `GOOGLE_CLOUD_STEP_BY_STEP.md` for deployment steps.
