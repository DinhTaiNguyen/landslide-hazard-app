@echo off
set PROJECT_ID=YOUR_PROJECT_ID
set REGION=australia-southeast1
set SERVICE_NAME=landslide-hazard-api
set CORS_ALLOW_ORIGINS=*

gcloud config set project %PROJECT_ID%
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy %SERVICE_NAME% ^
  --source ./backend ^
  --region %REGION% ^
  --allow-unauthenticated ^
  --memory 4Gi ^
  --cpu 2 ^
  --timeout 3600 ^
  --max-instances 2 ^
  --set-env-vars CORS_ALLOW_ORIGINS=%CORS_ALLOW_ORIGINS%
