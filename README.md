# mushyai

Private single-user 3D generation control room built as a static vanilla web app.

## Local development

- `npm install`
- `npm test`
- Open `index.html` directly, or serve the repo with any static file server.

## Docker

- Build and start: `docker compose up -d --build`
- Open: `http://YOUR_SERVER_IP:8080`
- Change the external port with `MUSHYAI_PORT=8095 docker compose up -d --build`

The container is intentionally simple:

- `nginx:alpine` serves the static files
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
3. Optionally set `MUSHYAI_PORT` in the stack environment if port `8080` is already in use.
4. Start the stack and open `http://UNRAID_IP:MUSHYAI_PORT`.

Because this app is private and intended for one user, there is no multi-user auth or shared backend. If you expose it beyond your LAN, put it behind your reverse proxy and access controls.
