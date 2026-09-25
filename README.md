# mediaSaver

Private media storage for images and videos. The browser uploads directly to
Cloudinary using server-issued signatures; Express verifies the uploaded asset,
stores its metadata in PostgreSQL, and serves each user's private gallery.

## Included

- JWT account registration, login, and profile lookup
- Authenticated Cloudinary upload and signed delivery URLs
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

## Verification

```powershell
cd BE; npm run typecheck
cd FE; npm run build; npm run lint
```

## Before deployment

- Set `CLIENT_URL` to the exact frontend origin.
- Enable Cloudflare Image Resizing for the frontend zone serving the gallery. The gallery requests `/cdn-cgi/image/.../<encoded-source-url>` variants for adaptive WebP delivery and a small blurred preview; if resizing is unavailable, it falls back to the original signed R2 URL.
- Configure R2 bucket CORS for the frontend origin with `PUT`, `Content-Type`, and exposed `ETag` headers; multipart upload resume reads each part's ETag in the browser. Multipart uploads support files up to 50 GB with 10 MB parts. Upload state is kept in the browser and verified against R2 when the user reselects the same file. R2 aborts incomplete multipart uploads after seven days by default.
- Run `npm run prisma:deploy` against the production database.
- Use a long, unique `JWT_SECRET` and keep Cloudinary credentials server-only.
- Add rate limiting, monitoring, backups, and automated authorization tests.
