# Release Verification Checklist

Tracks remaining integration tests required before Phase 10 can be called fully
verified. Phase 10.3 (CD workflow, secrets strategy, rollback guidance) is
**complete**. This checklist covers the *deployed behaviour* checks that are
still open.

> [!IMPORTANT]
> Work through these **without** removing Docker volumes or resetting the
> database. Existing data (registered accounts, any partially-uploaded media)
> is evidence. Delete nothing until you have identified its owner and state.

---

## Pre-flight

- [x] Start Docker Desktop (do not run `docker compose down -v`).
- [x] Confirm all containers are healthy:
  ```
  docker compose ps
  docker compose logs --tail=50 backend worker
  ```

---

## 1 — Upload completion (passed)

The upload completion flow and proxy configuration were verified on October 12, 2026:

- [x] Trust proxy configuration updated for Nginx reverse proxy, resolving `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
- [x] R2 image upload completed successfully via `POST /api/upload/r2/complete` returning 200 OK.
- [x] Database persistence confirmed: new media records saved in PostgreSQL.
- [x] Delivery URL and gallery viewing verified manually.

---

## 2 — Authentication assertion fix (partial)

Verified on October 12, 2026:

- [ ] Identify the specific assertion that threw in automated script runs.
- [ ] Fix the verification script to capture `RESP_STATUS` and `RESP_BODY` before asserting.
- [x] Re-run `scripts/verify-release.sh` locally against the Docker stack (`BASE_URL=http://localhost:8080`).
- [x] Confirm all checks pass (0 failures in the summary line).

---

## 3 — Worker processing (passed)

Verified on October 12, 2026:

- [x] Media record transitioned from `PENDING` to `READY` as expected upon processing.
- [x] Background worker picked up and completed metadata extraction jobs.
- [x] Controlled failure path: Tested retry policy (3 attempts with exponential backoff) and permanent/exhausted failure transition to `FAILED` (unit tested & verified).
- [x] Worker crash & recovery: Verified Redis-backed crash recovery where replacement worker completes pending jobs.

---

## 4 — Authorization and deletion (unverified)

- [ ] Register a second test user (User B).
- [ ] Attempt to `GET /api/media/:id` with User B's token where `:id` belongs
  to User A. Expect `404`.
- [ ] Attempt to `DELETE /api/media/:id` with User B's token. Expect `404`.
- [ ] Delete a media item as its owner (User A).
- [ ] Confirm the database row is gone:
  ```sql
  SELECT id FROM "Media" WHERE id = '<deleted-id>';
  -- Must return zero rows.
  ```
- [ ] Confirm the R2 object and all variants under
  `vault/users/<ownerId>/.variants/<mediaId>/` are removed from the bucket.

---

## 5 — Clean startup (previously passed; recheck after any image change)

Run this after the above checks are complete, to confirm nothing broke.

- [ ] Stop the stack: `docker compose down` (keep volumes).
- [ ] Rebuild from source: `docker compose build --no-cache`.
- [ ] Start fresh: `docker compose up --detach`.
- [ ] Confirm service health:
  - [ ] `postgres` → healthy
  - [ ] `redis` → healthy
  - [ ] `migrate` → exited 0
  - [ ] `backend` → healthy
  - [ ] `frontend` → healthy
  - [ ] `worker` → running (no immediate crash)

---

## 6 — CD workflow safeguard verification

- [ ] Confirm `workflow_run.branches: [main]` in
  [`.github/workflows/cd.yml`](file:///d:/Works/learning/mediaSaver/.github/workflows/cd.yml)
  limits automatic triggers to pushes on `main` (not PRs from other branches).
- [ ] Confirm the `check-ci` job condition drops the workflow when
  `conclusion != 'success'` (push a commit that intentionally fails CI and
  observe no deployment).
- [ ] Configure required reviewers on the `production` GitHub Environment
  (Settings → Environments → production → Required reviewers) so that
  `workflow_dispatch` cannot bypass human approval.
- [ ] Add at least one secret to the `production` environment and confirm the
  deploy job fails with a clear error if the secret is missing (rather than
  silently deploying with a blank value).

---

## 7 — End-to-end smoke test against the deployed target

Run only after a production server is available.

- [ ] Set `DEPLOY_BASE_URL` in the `production` GitHub Environment.
- [ ] Trigger the CD workflow manually (or push to `main`).
- [ ] Confirm the "Smoke test /api/health" step passes.
- [ ] Run the fuller verification script against the live URL:
  ```
  BASE_URL=https://your-domain.com \
  TEST_EMAIL=smoke@example.com \
  TEST_PASSWORD=SmokeVerify99! \
    ./scripts/verify-release.sh
  ```
- [ ] Record pass/fail for all seven checks in the script output.

---

## Status summary
 
| Check | Status | Evidence / Notes |
|---|---|---|
| Service startup & health | ✅ Passed | Containers healthy; PostgreSQL & Redis healthy |
| Database persistence | ✅ Passed | Account and media records persisted across operations |
| Upload completion & proxy | ✅ Passed | Trust proxy updated; `/api/upload/r2/complete` 200 OK |
| Worker processing | ✅ Passed | Jobs processed; media records reached `READY` |
| Gallery & viewing | ✅ Passed | Image viewing and delivery URL confirmed manually |
| Authentication assertion | ⚠️ Partial | Script response capture/assertion fix for automated runner |
| Authorization/deletion | ❓ Unverified | Cross-user isolation and cleanup tests |
| Clean startup | ✅ Previously passed | Core images build & start successfully |
| CD safeguards | ⚠️ Partial | Required-reviewer rule to be configured on GitHub |
| Production smoke test | ❓ Not started | Needs deployed production target |
