# Frontend deployment

This frontend is a static website.

## After backend deployment

Open `config.js` and set:

```js
window.APP_CONFIG = {
  API_BASE_URL: 'https://YOUR-CLOUD-RUN-URL'
};
```

Then deploy the frontend using either:

- **GitHub Pages**, or
- **Google Cloud Storage static hosting**

Detailed steps are in `../GOOGLE_CLOUD_STEP_BY_STEP.md`.
