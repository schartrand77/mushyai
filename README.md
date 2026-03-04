# mushyai

Private single-user 3D generation control room with a deterministic local backend, browser UI, and Docker-first deployment.

The app includes:

- Prompt-to-structured-3D interpretation through a local API
- Richer prompt packaging that turns a freeform request into a production-oriented model brief
- Debug output with interpreted spec JSON and generated Blender Python
- Downloadable delivered model packages that stay pinned in preview until cleared
- Unit tests plus containerized Playwright browser tests against the built image
- ESLint, Prettier, and a Vite production build

## Current capability boundary

- This project currently implements a **deterministic prompt-to-3D-spec workflow with reference-image metadata plumbing**.
- It supports **image upload validation and provenance capture**, but does **not** yet deliver accurate, model-based 2D-image-to-3D reconstruction.
- See `AUDIT_2D_TO_3D.md` and `PHASES_2D_TO_3D.md` for status, gaps, and roadmap phases.

## Local development

- `npm install`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- `npm test`
- Start the backend and frontend stack with Docker, or serve the static frontend through a web server that can proxy `/api/` to the backend.

## Docker

- Build and start: `docker compose up -d --build`
- Open: `http://YOUR_SERVER_IP:8081`
- Change the external port with `MUSHYAI_PORT=8095 docker compose up -d --build`

Optional backend worker settings:

- `RECONSTRUCTION_WORKER_URL` (default in Compose: `http://reconstruction-worker:8000`)
- `RECONSTRUCTION_WORKER_TIMEOUT_MS` (default: `8000`)
- `RECONSTRUCTION_WORKER_RETRIES` (backend retry count for worker calls, default: `1`)
- `RECONSTRUCTION_ARTIFACT_DIR` (worker-side optional output directory for per-job artifacts)
- `RECONSTRUCTION_MODEL_PROVIDER` (worker model id, default: `contour-prior-v1`)
- `RECONSTRUCTION_MODEL_VERSION` (worker model version, default: `0.1.0`)

The stack is intentionally simple:

- `nginx:alpine` serves the static files
- A Node backend exposes `/api/generate` and orchestrates reconstruction
- A Python reconstruction worker exposes `/reconstruct`
- The container filesystem is read-only
- Health checks run against the internal web endpoint
- App data remains browser-local through `localStorage`, which fits the single-user design

## Containerized E2E tests

- Install JS dependencies once: `npm install`
- Run browser tests locally if you already have Playwright browsers installed: `npm run test:e2e`
- Run the full Docker image test path in containers: `npm run test:e2e:docker`
- Clean up the E2E stack after a run if needed: `npm run test:e2e:docker:down`

The Docker E2E flow does this:

- Builds the production `mushyai` image
- Starts the app container and waits for its health check
- Builds a separate Playwright runner container
- Executes browser-level tests against `http://mushyai:8080`

## Unraid

Use Unraid's Compose Manager or the Docker Compose plugin and deploy this repository as a stack.

1. Copy the repo to your Unraid appdata area, for example `/mnt/user/appdata/mushyai`.
2. In Unraid, create a new stack that points at this repo's `docker-compose.yml`.
3. Optionally set `MUSHYAI_PORT` in the stack environment if port `8081` is already in use.
4. Start the stack and open `http://UNRAID_IP:MUSHYAI_PORT`.

Because this app is private and intended for one user, there is no multi-user auth or shared job store. If you expose it beyond your LAN, put it behind your reverse proxy and access controls.
