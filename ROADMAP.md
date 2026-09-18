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
- [ ] **Chunked Upload Engine for Large Media**
  - [ ] Implement client-side chunking (using File API) paired with a resumable backend upload endpoint to handle multi-gigabyte video uploads reliably.
- [ ] **On-the-Fly Image Optimization & CDN Caching**
  - [ ] Integrate dynamic image transformations (WebP auto-formatting, adaptive resolution sizing, blur-up placeholders) via Cloudinary URL manipulation or an AWS CloudFront/S3 edge layer.

# Phase 8: High-Performance Data Access & Caching
- [ ] **Redis Caching Layer for Hot Media & Sessions**
  - [ ] Implement a Redis caching layer for frequent database read operations (e.g., fetching user media feeds, checking session token blacklists).
  - [ ] Resume Bullet: Implemented a Redis caching strategy with TTL cache invalidation, cutting database query frequency for high-read routes.
- [ ] **Background Worker Architecture & Queue Management**
  - [ ] Offload heavy processing (EXIF extraction, thumbnail generation, video transcode triggers) to background workers using BullMQ / Redis.

# Phase 9: Real-Time Features & Collaboration
- [ ] **Real-Time Upload Progress & Dynamic Vault Updates**
  - [ ] Implement Socket.IO or Server-Sent Events (SSE) to stream processing status (e.g., "Processing", "Optimizing", "Ready") to the frontend UI live.
- [ ] **Time-Limited Presigned Media Sharing**
  - [ ] Create temporary, secure share links (with dynamic expiration times and optional password protection) using cryptographically signed access tokens.

# Phase 10: Enterprise DevOps & CI/CD Pipeline
- [ ] **Containerization & Local Multi-Service Orchestration**
  - [ ] Package the Node.js backend, React frontend, PostgreSQL database, and Redis instance into a production-ready docker-compose.yml environment.
- [ ] **Automated CI/CD Workflow with GitHub Actions**
  - [ ] Set up GitHub Actions pipelines to automate linting (eslint), type checking (tsc), Vitest unit/integration runs, and automated deployment on merged PRs.

