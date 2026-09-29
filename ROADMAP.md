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
- [x] **Auth Flow Edge Case Tests**
  - [x] Test token expiration, reset flows, and invalid Zod payloads.

## Phase 3: Rate Limiting & Auth Hardening
- [x] **Rate Limiting**
  - [x] Add `express-rate-limit` to `/login`, `/register`, `/forgot-password`, and upload routes.
- [x] **Token Strategy Upgrade**
  - [x] Transition from long-lived JWTs in `localStorage` to short-lived access tokens (15m).
  - [x] Implement HTTP-only, `SameSite=Strict` refresh cookies.

## Phase 4: Schema Cleanup & Production Setup
- [x] **Albums/Tags Alignment**
  - [x] Decide on CRUD routes/UI or prune unused models from `schema.prisma`.
- [x] **Deployment & Environment Setup**
  - [x] Finalize `.env.example`.
  - [x] Configure build scripts and set up error logging (e.g., Sentry).

# Phase 5: Complete the FE Refresh Token Interceptor
- [x] **Intercept 401 Unauthorized responses on API calls.**
- [x] **Call POST /api/auth/refresh behind the scenes to get a new accessToken.**
- [x] **Retry the original failed request automatically without forcing the user to re-login.**

# Phase 6: Rate Limiting for Upload Routes
- [x] **Apply the uploadLimiter middleware to /api/upload routes in upload.ts to protect Cloudinary signatures and media uploads from spam/abuse.**

# Phase 7: Advanced Storage Engine & Streaming
- [x] **Chunked Upload Engine for Large Media**
  - [x] Implement client-side chunking (using File API) paired with a resumable backend upload endpoint to handle multi-gigabyte video uploads reliably.
- [x] **On-the-Fly Image Optimization & Variant Caching**
  - [x] Transform image variants with Sharp, cache private WebP variants in R2, and show a low-resolution blur-up placeholder. Verified transformed delivery, cache hits, and variant cleanup in the live app.

# Phase 8: High-Performance Data Access & Caching
- [x] **Redis Caching Layer for Hot Media & Sessions**
  - [x] Implement a Redis caching layer for frequent database read operations (e.g., fetching user media feeds, checking session token blacklists).
  - [x] Resume Bullet: Implemented a Redis caching strategy with TTL cache invalidation, cutting database query frequency for high-read routes.
- [x] **Background Worker Architecture & Queue Management**
  - [x] Offload heavy processing (EXIF extraction, thumbnail generation, video transcode triggers) to background workers using BullMQ / Redis.
  - [x] Token Hydration & Security: Secured JWT access tokens in memory with httpOnly refresh token rotation on app boot.

# Phase 9: Production Reliability & Failure-Path Testing
- [x] **9.1 Authentication & Session Reliability**
  - [x] Test refresh-token rotation and revocation.
  - [x] Test concurrent refresh requests and prevent refresh races from causing unexpected logouts.
  - [x] Verify expired, revoked, and replayed refresh tokens are rejected.
  - [x] Verify logout invalidates the refresh session correctly.
  - [ ] Coordinate refresh-token rotation across browser tabs **(Issue 38)**.

- [ ] **9.2 Chunked Upload Reliability**
  - [ ] Test interrupted uploads and successful resumption.
  - [ ] Validate chunk ordering, completeness, and upload-session ownership.
  - [ ] Make chunk retries safe and prevent duplicate or corrupted uploads.
  - [ ] Clean up abandoned upload sessions and temporary chunks.
  - [ ] Handle storage failures without leaving inconsistent database records.

- [ ] **9.3 Media Authorization & Storage Consistency**
  - [ ] Verify ownership checks on all media read, update, delete, and download paths.
  - [ ] Verify private R2 variants cannot bypass application authorization.
  - [ ] Ensure cached media cannot leak between users.
  - [ ] Verify database, Cloudinary, and R2 cleanup behavior when deletion partially fails.
  - [ ] Ensure media updates and deletions invalidate relevant caches.

- [ ] **9.4 Background Worker Reliability**
  - [ ] Configure and test BullMQ retry policies and backoff.
  - [ ] Handle failed jobs and make failures observable through logs.
  - [ ] Make processing idempotent where retries could repeat side effects.
  - [ ] Test worker restarts and recovery of pending jobs.
  - [ ] Prevent duplicate processing from producing inconsistent metadata or storage objects.

# Phase 10: CI/CD & Reproducible Development Environment
- [ ] **10.1 GitHub Actions**
  - [ ] Create a GitHub Actions workflow triggered by pushes and pull requests.
  - [ ] Run ESLint.
  - [ ] Run TypeScript type checking with tsc --noEmit.
  - [ ] Run Vitest unit and integration tests.
  - [ ] Configure required checks to fail when a step fails.
  - [ ] Provide the necessary test environment variables and service dependencies.

- [ ] **10.2 Docker & Local Orchestration**
  - [ ] Create or finalize the backend Dockerfile.
  - [ ] Create or finalize the frontend Dockerfile.
  - [ ] Configure Docker Compose for the application, PostgreSQL, and Redis.
  - [ ] Configure environment variables without embedding secrets in images.
  - [ ] Configure persistent database storage and health checks.
  - [ ] Document Prisma migrations and database initialization.
  - [ ] Verify the project can be started from a clean checkout using the documented steps.

- [ ] **10.3 Deployment Workflow**
  - [ ] Decide whether deployment remains manual or is triggered by a successful CI workflow.
  - [ ] Document the deployment process and required environment variables.
  - [ ] Keep production secrets in the deployment platform or GitHub Actions secrets.
  - [ ] Verify the deployed application after releases.
  - [ ] Add a rollback procedure appropriate to the existing hosting setup.

# Phase 11: Portfolio Documentation & Interview Readiness
- [ ] **11.1 README & Architecture**
  - [ ] Write a project overview describing the problem and main features.
  - [ ] Document the technology stack and key design decisions.
  - [ ] Add an architecture diagram covering the frontend, Express API, PostgreSQL, Redis, workers, and storage providers.
  - [ ] Document the upload and background-processing lifecycles.
  - [ ] Document authentication, refresh-token rotation, and ownership enforcement.
  - [ ] Provide .env.example and step-by-step local setup instructions.
  - [ ] Document test commands and deployment instructions.
  - [ ] Add screenshots and a link to the deployed demo.

- [ ] **11.2 Engineering Evidence**
  - [ ] Record measurable caching or processing improvements where benchmarks are available.
  - [ ] Document important trade-offs and known limitations.
  - [ ] Ensure all performance claims in the README and CV are supported by evidence.
  - [ ] Remove or correct documentation that no longer matches the implementation.

- [ ] **11.3 CV & Interview Preparation**
  - [ ] Finalize three concise mediaSaver project bullets for the CV.
  - [ ] Link the GitHub repository and deployed demo.
  - [ ] Prepare a 3–5 minute project walkthrough.
  - [ ] Prepare to explain authentication, authorization, uploads, caching, and background processing.
  - [ ] Practice debugging and discussing failure scenarios from the actual implementation.

# Phase 12: Real-Time Features & Collaboration

Implement only after Phases 9–11 are complete or if a concrete requirement justifies the work.

- [ ] **12.1 Real-Time Processing Updates**
  - [ ] Decide whether SSE or Socket.IO is justified by the product requirements.
  - [ ] Stream processing states such as Processing, Optimizing, Ready, and Failed.
  - [ ] Update the frontend when processing state changes.
  - [ ] Enforce user authorization on status subscriptions.
  - [ ] Handle reconnects and retrieve the current status after reconnection.

- [ ] **12.2 Time-Limited Media Sharing**
  - [ ] Create temporary share links with configurable expiration.
  - [ ] Use cryptographically secure, unguessable share tokens.
  - [ ] Enforce expiration and revocation on every share access.
  - [ ] Support optional password protection with secure password hashing.
  - [ ] Prevent share links from bypassing private-storage access controls.
  - [ ] Add tests for expired links, revoked links, and incorrect passwords.

## Project Completion Criteria

mediaSaver is ready for portfolio use when:

- [ ] The deployed application's core functionality works.
- [ ] Critical authorization and failure paths are covered by automated tests.
- [ ] GitHub Actions runs linting, type checking, and tests successfully.
- [ ] A new developer can configure and run the application using the README.
- [ ] Architecture and important technical decisions are documented.
- [ ] The repository, deployed demo, and CV links are ready to share.
- [ ] The developer can explain the implementation, trade-offs, and limitations in an interview.