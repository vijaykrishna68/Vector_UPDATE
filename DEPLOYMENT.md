# Deployment (Vercel + Render/Fly)

This project is split into:
- Frontend (Vite/React): `client/scheduler-fe`
- Backend API (Express): `server`

## 1) Deploy backend (Render example)
1. Create a new Web Service from your repo.
2. Root directory: `server`
3. Build command: `npm install`
4. Start command: `npm start`
5. Env vars:
   - `CORS_ORIGINS` = your Vercel URL (e.g. `https://your-app.vercel.app`)

After deploy, note the backend URL (e.g. `https://your-backend.onrender.com`).

## 2) Deploy frontend (Vercel)
1. Create a Vercel project.
2. Root directory: `client/scheduler-fe`
3. Framework: Vite
4. Set env var:
   - `VITE_API_URL` = your backend URL

Vite 7 expects Node.js `20.19+` (or `22.12+`). If your host defaults to an older Node 20 minor, configure the project to use a newer Node version.

## 3) Quick sanity check
1. Open the Vercel URL.
2. Upload an Excel file.
3. Confirm:
   - The browser downloads a processed `.xlsx` immediately
   - The Schedule tab can load week summaries after upload

## Notes
- Current setup is "public" (no auth). Anyone with the URL can upload and overwrite shared results.
- If you later want per-client separation, the backend will need a tenant key per upload.

## Storage model
This deployment is intentionally stateless:
- Uploads are processed in-memory.
- The processed Excel file is returned directly in the response.
- No cloud storage, filesystem storage, or database persistence is used.
