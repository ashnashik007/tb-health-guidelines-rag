# TB Health Guidelines RAG

FastAPI + ChromaDB backend and React/Vite frontend for asking questions against WHO TB guideline PDFs. Groq credentials are read by the backend from environment variables; never put them in frontend variables.

## Local development

Backend (PowerShell):

```powershell
cd "D:\New folder\health-rag\backend"
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:FRONTEND_ORIGINS = "http://localhost:5173"
uvicorn main:app --host 0.0.0.0 --port 8000
```

Before starting, set `GROQ_API_KEY` and a long random `DOCUMENT_ADMIN_KEY` in `backend/.env`, optionally with `GROQ_MODEL`. Do not commit `.env`. The same document admin key is entered in the Documents upload card; it is held only in page memory. The default local Chroma path is `backend/chroma_db`; the default PDF directory is `data/`.

Frontend (separate PowerShell):

```powershell
cd "D:\New folder\health-rag\frontend"
Copy-Item .env.example .env.local
# Set VITE_API_URL=http://localhost:8000 in .env.local
corepack pnpm install --frozen-lockfile
pnpm dev
```

If you prefer npm, `npm install` and `npm run dev` also work, but use one package manager consistently because the checked-in lockfile is pnpm's.

## Render backend

Use the root `render.yaml` Blueprint, or create a Python Web Service with the repository root as its root directory, build command `pip install -r backend/requirements.txt`, start command `uvicorn main:app --app-dir backend --host 0.0.0.0 --port $PORT`, and health check path `/health`. Keeping the repository root available lets the runtime copy the bundled PDFs from `data/`. Render supplies `PORT`; the start command binds to all interfaces. Set these service environment variables:

| Variable | Value |
| --- | --- |
| `PYTHON_VERSION` | `3.14.8` (pinned in `render.yaml`; local venv inspected as Python 3.14.0) |
| `GROQ_API_KEY` | Secret value from your Groq account; set as a secret in Render |
| `DOCUMENT_ADMIN_KEY` | Long, unique secret used to authorize `/upload` and `/ingest`; set as a secret in Render |
| `GROQ_MODEL` | Optional; defaults to the model configured by the backend |
| `FRONTEND_ORIGINS` | Exact Vercel origin, e.g. `https://your-app.vercel.app` (comma-separated for additional trusted origins) |
| `CHROMA_PERSIST_DIR` | `/var/data/chroma_db` |
| `DATA_DIR` | `/var/data/documents` |
| `HF_HOME` | `/var/data/huggingface` |

The Blueprint requests a paid Render instance and persistent disk mounted at `/var/data`. Render's free web services do not support persistent disks; their local files can be lost during restarts or redeploys. Choose disk capacity for the Chroma index, embedding model cache, and uploaded PDFs. At first service start, bundled PDFs are copied into `DATA_DIR` only when that filename is absent. Index them once by calling `POST /ingest` after deployment with the `X-Document-Admin-Key` header set to `DOCUMENT_ADMIN_KEY`. Repeating ingestion will use stable chunk IDs and replace stale chunks for each PDF rather than append duplicates. Uploads require the same key in the Documents page.

Render deployments do not copy your local `backend/chroma_db` or its backup; those directories are excluded from Git. The WHO PDFs remain in `data/` and are copied into the mounted directory at runtime.

## Vercel frontend

Import the repository into Vercel and set the project root directory to `frontend`. Use the Vite preset, build command `npm run build`, and output directory `dist` (Vercel usually detects these automatically). Add this environment variable for Production and Preview as needed:

- `VITE_API_URL=https://<your-render-service>.onrender.com` (origin only, no trailing slash)

Redeploy after changing the variable because Vite embeds it at build time. Configure the matching exact Vercel origin in the backend's `FRONTEND_ORIGINS`. The frontend does not receive or need the Groq API key.

## Deployment checks

1. Confirm `GET /health` returns HTTP 200 from the Render URL.
2. Confirm browser requests from the Vercel origin to `/documents`, `/evaluation`, and `/ask` pass CORS.
3. Set the Groq secret in Render and verify a grounded question; the API key must never appear in browser assets or logs.
4. Call `/ingest` with `X-Document-Admin-Key` once; verify `/documents` lists the WHO PDFs and ask a question with citations.
5. Restart/redeploy the backend and confirm the mounted Chroma directory and PDFs persist.
6. Confirm `/upload` and `/ingest` reject requests with a missing or incorrect admin key.

Evaluation reports and local Chroma databases are generated/local data and are excluded from source control. Keep backups outside the deployment instance as an independent backup strategy.

## Deployment order

1. Confirm no secrets or generated databases are staged. The current workspace does not contain a root `.git` directory, so `git check-ignore` cannot be run here; after connecting/initializing a Git repository, verify with `git check-ignore -v backend/.env backend/venv/Scripts/python.exe backend/chroma_db/chroma.sqlite3 backend/chroma_db_backup/chroma.sqlite3 frontend/.env frontend/node_modules/ evaluation/evaluation_report.csv`. Do not add or push until the status contains only intended source files.
2. Connect the repository to Render and create the backend from the root Blueprint. Add `GROQ_API_KEY`, a long random `DOCUMENT_ADMIN_KEY`, and the initial `FRONTEND_ORIGINS` value. Keep both secrets in Render's secret environment settings.
3. Deploy Render and save the service URL. Confirm `GET <render-url>/health` returns HTTP 200.
4. In Vercel, import the same repository with project root `frontend`, build command `pnpm build` (or `npm run build`), output directory `dist`, and `VITE_API_URL=<render-url>`. Deploy and record the Vercel origin.
5. Set Render `FRONTEND_ORIGINS` to the exact Vercel origin, save, and redeploy the backend.
6. After backend redeploy, call `POST <render-url>/ingest` once through an HTTPS API client, sending the `X-Document-Admin-Key` header with the configured document admin secret. The bundled PDFs are copied to the Render disk at startup. Verify documents and ask a grounded question.
7. Check that upload works in the Vercel Documents page when the authorized operator enters the document admin key. Confirm unauthenticated `/upload` and `/ingest` requests return HTTP 401.

No deployment or Git push was performed as part of this setup.
