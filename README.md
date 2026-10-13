# mediaSaver

Private media storage for images and videos. The browser uploads directly to
Cloudflare R2 using server-issued signatures; Express verifies the uploaded
asset, stores its metadata in PostgreSQL, and serves each user's private gallery.

## Included

- JWT account registration, login, and profile lookup
- Authenticated Cloudflare R2 uploads and signed delivery URLs
- Per-user media ownership enforcement
- Cursor-paginated image/video gallery with lightbox viewer
- Delete flow that removes the Cloudinary asset before its PostgreSQL record
- Prisma schema and PostgreSQL migration history

## Local setup

1. Install dependencies:

   ```powershell
   cd BE; npm install
   cd ../FE; npm install
   ```

2. Copy `BE/.env.example` to `BE/.env`, then configure PostgreSQL, Cloudinary,
   and a strong `JWT_SECRET`. Do not commit `.env`.

3. Apply the database migrations:

   ```powershell
   cd BE
   npm run prisma:deploy
   ```

   For a new development database, `npm run prisma:migrate -- --name your_change`
   creates future migrations. Do not edit migrations that have been applied.

4. Run the app in two terminals:

   ```powershell
   cd BE; npm run dev
   cd FE; npm run dev
   ```

   Open `http://localhost:5173`.

## Docker Compose setup

Prerequisites: Docker Desktop (or Docker Engine) with the Compose plugin. These
steps use only the checked-in migration history and a local `.env` file.

1. From the repository root, create your local Compose environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

   The checked-in values are for local development. Replace both JWT secrets
   with long random values before sharing the host or exposing the app. Never
   put secrets in a Dockerfile or frontend `VITE_*` variable: frontend build
   variables become public in the browser bundle. The optional R2 placeholders
   allow the API to start, but actual upload/download operations need real R2
   account, access key, secret, bucket, and public domain values in `.env`.

   For uploads, set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   and `R2_BUCKET_NAME` to a real Cloudflare R2 bucket and API token with
   object read/write permissions. Configure that bucket's CORS policy to allow
   origin `http://localhost:8080`, method `PUT`, request header `Content-Type`,
   and expose response header `ETag` (needed by multipart uploads). If you
   change `FRONTEND_PORT`, use the matching origin such as
   `http://localhost:8081` in the bucket CORS policy. Restart the API after
   changing `.env` with `docker compose up -d --force-recreate backend worker`.

   Password reset needs Gmail SMTP credentials: set `GMAIL_USER` to the Gmail
   account and `GMAIL_APP_PASSWORD` to an app password created for that account
   (not the regular Gmail password). Set `CLIENT_URL` to the browser URL where
   the reset page should open. Recreate the backend after changing these values.

2. Build images and start the stack:

   ```powershell
   docker compose up --build -d
   ```

   Compose waits for PostgreSQL and Redis health checks, runs the one-shot
   `migrate` service (`prisma migrate deploy`), then starts the backend, media
   worker, and frontend. The app is available at `http://localhost:8080`; the
   backend health endpoint is `http://localhost:8080/api/health`.

3. Check startup and migration status:

   ```powershell
   docker compose ps
   docker compose logs migrate backend worker frontend
   ```

   `migrate` should exit with code 0. The API and frontend should report
   healthy; the worker should log that it started.

4. To apply migrations after pulling a change, rebuild and start again:

   ```powershell
   docker compose up --build -d
   ```

   Compose runs `prisma migrate deploy` before the API and worker. To create a
   new migration during development, use a PostgreSQL development database and
   `cd BE; npm run prisma:migrate -- --name descriptive_change`; commit the
   generated migration directory. Do not use `migrate dev` against production.

5. Stop the containers while retaining database and Redis data:

   ```powershell
   docker compose down
   ```

   To delete local database and Redis data as well, run
   `docker compose down --volumes` (this permanently removes those local
   volumes).

### Compose services and configuration

- `frontend`: production Vite build served by Nginx; `/api` requests are
  proxied to the backend, so the browser uses one origin.
- `backend`: Express API on the private Compose network, started only after
  migrations finish successfully and Redis is healthy.
- `worker`: BullMQ media worker, using the same backend image and runtime
  environment.
- `migrate`: one-shot Prisma migration deploy using the backend image.
- `postgres` and `redis`: health-checked services with named persistent
  volumes (`postgres_data` and `redis_data`).

All runtime configuration comes from the root `.env`; Compose passes it to
containers at runtime. Build contexts exclude `.env` files, and no credentials
are baked into either image. The default PostgreSQL credentials and JWT values
are suitable only for a local machine; change them for any shared environment.

## Verification

```powershell
cd BE; npm run typecheck
cd FE; npm run build; npm run lint
```

## Before deployment

- Set `CLIENT_URL` to the exact frontend origin.
- Image previews are transformed by the authenticated backend with Sharp, converted to WebP, and cached as private R2 variants. Short-lived media-scoped tokens let browser image requests reach the transformer without exposing original objects. Generated variants are removed when their media item is deleted; source images larger than 32 MB are served unmodified.
- Configure R2 bucket CORS for the frontend origin with `PUT`, `Content-Type`, and exposed `ETag` headers; multipart upload resume reads each part's ETag in the browser. Multipart uploads support files up to 50 GB with 10 MB parts. Upload state is kept in the browser and verified against R2 when the user reselects the same file. R2 aborts incomplete multipart uploads after seven days by default.
- Run `npm run prisma:deploy` against the production database.
- Use a long, unique `JWT_SECRET` and keep Cloudinary credentials server-only.
- Add rate limiting, monitoring, backups, and automated authorization tests.
