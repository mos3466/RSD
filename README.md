# RSD — Riyadh Metro Intelligent Monitoring

RSD is a full-stack prototype for privacy-first metro monitoring. It preserves the existing browser camera experience and TensorFlow.js detection flow, while adding authenticated operations data, persistent incident review, and secure evidence storage.

## What is real vs simulated

- **Browser camera:** real device camera access through `getUserMedia`, when the browser and permissions allow it.
- **Computer Vision:** browser-side TensorFlow.js models (COCO-SSD, MobileNet, MoveNet) run on the current camera stream.
- **Person IDs:** anonymous session IDs such as `P034`; no face recognition or real identity storage.
- **Riyadh Metro camera feeds:** not connected. `C01`, `C02`, `C04`, and `C05` are simulation labels.
- **Backend detections:** authenticated operators can persist AI-generated detection events in the database.
- **Incident decisions:** AI creates `pending` incidents. Only an authenticated admin can mark an incident `confirmed` or `rejected`.
- **Evidence:** file bytes are stored in Manus object storage; the database stores metadata and the storage reference only.

## Stack

- React 19 + Vite + TypeScript
- Express + tRPC 11
- Manus OAuth authentication
- Drizzle ORM + MySQL/TiDB
- Manus object storage via `server/storage.ts`
- TensorFlow.js in the browser
- Vitest tests

## Local setup

1. Install Node.js 20+ and pnpm 10+.
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Configure the environment using `.env.example` as a reference. Never commit real secrets.
   On Windows, run `setup-windows.cmd` once to create `.env` and generate local session/bridge secrets.
4. Generate and apply database migrations:

   ```bash
   pnpm drizzle-kit generate
   pnpm drizzle-kit migrate
   ```

5. Start the development server:

   ```bash
   pnpm dev
   ```

   The `dev` script is cross-platform and works in Windows CMD/PowerShell; it no longer
   relies on the POSIX-only `NODE_ENV=development command` syntax.

6. Open the printed local URL. Camera access requires HTTPS or localhost and browser permission.

7. Verify readiness at `http://localhost:3000/api/health`. A successful RFID setup returns
   `ok: true`; otherwise the response identifies whether `DATABASE_URL` or the bridge key is missing.

## Environment variables

The hosted Manus project injects these values automatically. For independent deployment, provide equivalent values through the hosting provider's secret manager:

- `DATABASE_URL` — MySQL/TiDB connection string.
- `JWT_SECRET` — session signing secret.
- `VITE_APP_ID` — Manus OAuth application ID.
- `OAUTH_SERVER_URL` — OAuth API base URL.
- `VITE_OAUTH_PORTAL_URL` — frontend OAuth portal URL.
- `OWNER_OPEN_ID` and `OWNER_NAME` — owner account information.
- `BUILT_IN_FORGE_API_URL` and `BUILT_IN_FORGE_API_KEY` — server-side object storage and built-in APIs.

The copied `env.example` intentionally leaves credentials blank. Do not leave the old
placeholder `mysql://USER:PASSWORD@HOST:3306/DATABASE` in `.env`: the server will disable
persistence instead of attempting to resolve the fake hostname `HOST`. RFID trips and
dashboard data require a reachable MySQL/TiDB `DATABASE_URL`.

Do not expose `DATABASE_URL`, `JWT_SECRET`, or `BUILT_IN_FORGE_API_KEY` in client code.

## Backend API

All procedures are under `/api/trpc`:

- `auth.me` and `auth.logout`
- `evidence.list` and `evidence.upload`
- `dashboard.summary`
- `dashboard.incidents`
- `dashboard.recordDetection`
- `dashboard.reviewIncident`

The frontend uses the typed tRPC client in `client/src/lib/trpc.ts`; no ad-hoc REST or Axios layer is required.

## Database models

- `users` — authenticated operators.
- `evidenceFiles` — file metadata and storage references; never file bytes.
- `detectionEvents` — model output, camera label, confidence, source, and anonymous journey references.
- `incidents` — review state, reviewer, timestamp, and review note.

## Testing and production build

```bash
pnpm run check
pnpm test
pnpm run build
```

The tests cover authentication, evidence authorization and validation, detection validation, and admin-only incident review.

## Important product limitations

The prototype does not claim to be connected to Riyadh Metro infrastructure. Real metro cameras, production YOLO/ByteTrack/Re-ID services, retention policies, operator provisioning, and production observability still require deployment-specific integration and credentials. The existing browser AI remains a demonstration/MVP inference path.

## RFID Arduino integration

The project includes a hardware integration under `hardware/`: an Arduino Uno + RC522 sketch and a Python USB Serial bridge. The bridge sends scans to the protected `/api/rfid/trips` endpoint, which creates unique `T000001`-style Trip IDs, stores only a SHA-256 card UID hash, and deduplicates retries through an idempotency key. See `hardware/README.md` for wiring and COM-port setup.

The cloud environment cannot access physical Arduino hardware, so the final card-scan loop must be tested on the computer connected to the Uno.
