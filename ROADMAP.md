# Project Roadmap & Lifecycle TODOs

## Phase 1: Media Lifecycle APIs & UI (Highest Immediate Impact)
- [x] **Delete Media & Cloudinary Cleanup** (`DELETE /api/media/:id`)
  - [x] Implement Prisma DB record deletion.
  - [x] Integrate Cloudinary SDK asset destruction.
- [x] **Download & Metadata Editing** (`PATCH /api/media/:id`)
  - [x] Build UI modal for renaming/editing titles.
  - [x] Add full-resolution download links.

## Phase 2: Automated Testing & Security Boundaries
- [x] **Multi-Tenant Ownership Integration Tests**
  - [x] Write Vitest/Supertest suites enforcing user isolation.
  - [x] Verify 403/404 responses when User A accesses User B's media.
- [ ] **Auth Flow Edge Case Tests**
  - [ ] Test token expiration, reset flows, and invalid Zod payloads.

## Phase 3: Rate Limiting & Auth Hardening
- [ ] **Rate Limiting**
  - [ ] Add `express-rate-limit` to `/login`, `/register`, `/forgot-password`, and upload routes.
- [ ] **Token Strategy Upgrade**
  - [ ] Transition from long-lived JWTs in `localStorage` to short-lived access tokens (15m).
  - [ ] Implement HTTP-only, `SameSite=Strict` refresh cookies.

## Phase 4: Schema Cleanup & Production Setup
- [ ] **Albums/Tags Alignment**
  - [ ] Decide on CRUD routes/UI or prune unused models from `schema.prisma`.
- [ ] **Deployment & Environment Setup**
  - [ ] Finalize `.env.example`.
  - [ ] Configure build scripts and set up error logging (e.g., Sentry).