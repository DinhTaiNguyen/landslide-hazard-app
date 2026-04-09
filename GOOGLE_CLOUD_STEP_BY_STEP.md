# Google Cloud step-by-step setup

This guide moves your backend API from Render to **Google Cloud Run**.

## Best setup for your project

Because your website is static but your API is Python/FastAPI, the easiest working structure is:

- **Frontend**: GitHub Pages or Google Cloud Storage
- **Backend API**: Google Cloud Run

That means your website stays simple and cheap, while the heavy Python backend runs on Google Cloud.

---

## Part 1. Prepare a Google Cloud project

1. Go to Google Cloud Console.
2. Create a new project, or choose an existing project.
3. Make sure billing is enabled for that project.
4. Open **Cloud Shell** or install **Google Cloud CLI** on your computer.

Official docs: Cloud Run supports source deployment with `gcloud run deploy --source`, and Cloud Storage can host static websites. citeturn112443search0turn112443search1

---

## Part 2. Enable the required services

Run these commands:

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

Cloud Run is the managed runtime for the backend, while Cloud Build builds the image from your source code during deployment. citeturn112443search0turn112443search20

---

## Part 3. Deploy the backend to Cloud Run

From the unzipped project folder, run:

```bash
gcloud run deploy landslide-hazard-api \
  --source ./backend \
  --region australia-southeast1 \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 2 \
  --set-env-vars CORS_ALLOW_ORIGINS=*
```

Why these settings:

- `--source ./backend`: deploy only the FastAPI backend folder
- `--allow-unauthenticated`: lets your frontend call the API publicly
- `--memory 4Gi`: safer for FORM / ML than small memory sizes
- `--timeout 3600`: allows long runs
- `CORS_ALLOW_ORIGINS=*`: lets the browser call the API from your frontend domain

Cloud Run can deploy directly from source code with one command, and Python/FastAPI is supported by the current Cloud Run source deployment flow. citeturn112443search0turn112443search20turn112443search11

After deployment, Google Cloud prints a service URL such as:

```
https://landslide-hazard-api-xxxxx-australia-southeast1.run.app
```

Save that URL.

---

## Part 4. Check that the backend works

Open:

```
https://YOUR_CLOUD_RUN_URL/api/health
```

You should see a JSON response.

Also open:

```
https://YOUR_CLOUD_RUN_URL/
```

You should see backend info including the allowed CORS origins.

---

## Part 5. Connect the frontend to the new Google Cloud API

Open these files:

- `config.js`
- `frontend/config.js`

Replace:

```js
https://REPLACE_WITH_YOUR_CLOUD_RUN_BACKEND_URL
```

with your real Cloud Run URL, for example:

```js
https://landslide-hazard-api-xxxxx-australia-southeast1.run.app
```

This project has already been updated so it no longer points to Render by default.

---

## Part 6A. Deploy the frontend with GitHub Pages

This is usually the easiest option for your static website.

1. Create a GitHub repository.
2. Upload the frontend files from the project root: `index.html`, `style.css`, `script.js`, `config.js`, and `images/`.
3. In GitHub, go to **Settings -> Pages**.
4. Set the source branch, usually `main`, and folder `/root`.
5. Wait for the Pages URL.
6. Open the site and test the API calls.

---

## Part 6B. Deploy the frontend with Google Cloud Storage

If you want the frontend also on Google Cloud, create a Storage bucket and host the static files there. Google Cloud Storage supports static website hosting for client-side files like HTML, CSS, and JavaScript. citeturn112443search1turn112443search4

Typical flow:

```bash
gsutil mb -l australia-southeast1 gs://YOUR_BUCKET_NAME
gsutil web set -m index.html -e 404.html gs://YOUR_BUCKET_NAME
gsutil iam ch allUsers:objectViewer gs://YOUR_BUCKET_NAME
gsutil -m cp -r index.html style.css script.js config.js images gs://YOUR_BUCKET_NAME
```

Note: bucket-based website hosting is mainly for static websites. Your Python API should still stay on Cloud Run. citeturn112443search1turn112443search4

---

## Part 7. If the frontend cannot call the backend

This is usually a CORS problem.

For testing, keep:

```
CORS_ALLOW_ORIGINS=*
```

For production, use your exact frontend domain instead, for example:

```
CORS_ALLOW_ORIGINS=https://YOUR_USERNAME.github.io
```

or

```
CORS_ALLOW_ORIGINS=https://www.your-domain.com
```

The backend in this package was modified to read `CORS_ALLOW_ORIGINS` from environment variables automatically.

Redeploy after changing it:

```bash
gcloud run deploy landslide-hazard-api \
  --source ./backend \
  --region australia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars CORS_ALLOW_ORIGINS=https://YOUR_FRONTEND_DOMAIN
```

---

## Part 8. Recommended first test after deployment

1. Open the website
2. Check browser developer console
3. Confirm `GET /api/health` works
4. Upload a very small test dataset first
5. Run one small FORM case
6. Then test ML

---

## Part 9. Important note about long jobs

Your current backend stores jobs in memory and on the local container filesystem. That can work for testing and light usage, but Cloud Run containers are ephemeral. If a container restarts, in-memory job state and local temporary files can disappear. Cloud Run is designed for stateless services. citeturn112443search23turn112443search5

So, for your next upgrade, the safer production architecture would be:

- store uploaded/input/output files in **Cloud Storage**
- store job status in **Firestore** or another database
- optionally move very long non-HTTP workloads to **Cloud Run Jobs**

Cloud Run Jobs are meant for tasks that run and exit, unlike normal services that respond to HTTP requests. citeturn112443search12

For now, the current code can still be used for early testing and demos, especially if you keep one or two users and modest file sizes.

---

## Part 10. Files changed in this package

This zip was prepared with these Google Cloud changes:

- `config.js` now expects a Cloud Run backend URL
- `frontend/config.js` now expects a Cloud Run backend URL
- `backend/app.py` now reads `CORS_ALLOW_ORIGINS` from environment variables
- `cloudbuild.yaml` now uses configurable substitutions
- `backend/Dockerfile` added
- deployment scripts added

---

## Fastest path to get working today

1. Unzip the package
2. Run the Cloud Run deploy command in Part 3
3. Copy the Cloud Run URL
4. Paste it into `config.js` and `frontend/config.js`
5. Upload the frontend to GitHub Pages
6. Open the site and test `/api/health`

That is the most direct route.
