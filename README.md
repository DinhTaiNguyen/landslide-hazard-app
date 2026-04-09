# Landslide Hazard App

This repo now includes two workflows:

1. **FORM Panel**
   - upload DEM / slope / soiltype / soilthickness
   - create multiple GeoTOP PWP folder run boxes
   - run FORM directly from the website
   - preview and download PoF.asc, FS_min.asc, FS_min_depth.asc, beta.asc

2. **Machine Learning tab**
   - upload a maps folder (base + additional ASC maps)
   - upload a FORM outputs folder that contains event subfolders with PoF.asc
   - auto-detect event ids from subset-folder names
   - edit rainfall E, D, PI per event
   - generate `stage1_base_dataset.csv`
   - configure Stage 1 / Stage 2 events and hyperparameters
   - upload `landslide_label.asc` for Stage 2 if needed
   - run machine learning and preview/download result ASC maps and plots

## Backend deployment

Render build command:

```bash
pip install -r requirements.txt
```

Render start command:

```bash
uvicorn app:app --host 0.0.0.0 --port $PORT
```

This assumes Render root directory is set to `backend`.

## Python packages

The backend needs:
- fastapi
- uvicorn[standard]
- python-multipart
- numpy
- pandas
- matplotlib
- scikit-learn
- torch


Cloud Run / Cloud Build
- cloudbuild.yaml deploys the backend from ./backend to Cloud Run.
- Update service name, region, memory, and CORS as needed.
- .gcloudignore keeps frontend assets and local caches out of backend source deploys.
