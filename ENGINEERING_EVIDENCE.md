# Engineering Evidence

Snapshot prepared October 14, 2026 from the checked-in source and locally runnable commands. No throughput or latency improvement is claimed because no controlled workload benchmark was run.

## Test inventory

The backend package defines the Vitest `npm test` command. The repository inventory lists **9 backend test files**:

- **Unit (2 files):** `mediaWorker.test.js` (4 cases) and `mediaMetadata.test.js` (4 cases).
- **Integration (7 files):** `r2.multipart.test.js`, `media.ownership.test.js`, `media.delete-consistency.test.js`, `media.cache-isolation.test.js`, `auth.reset.test.js`, `auth.rateAndRefresh.test.js`, and `auth.edge.test.js`.

A test file's presence in the repository is not evidence that its tests passed. For the October 14, 2026 snapshot, the two unit test files passed with 8 tests total. The full backend test command did not produce a completed integration-suite summary, so the overall suite result remains **incomplete / unverified**.


## Checks run for this snapshot

| Check | Result | Notes |
|---|---|---|
| Backend targeted unit tests | 8 passed | `npm.cmd test -- --reporter=verbose` began the entire suite; both unit files passed. |
| Backend full test command | Incomplete | The command remained running after the unit tests; stopped before integration summary. Do not treat this as a full-suite pass. |
| Docker Compose availability | Unavailable | Docker CLI could not connect to the Docker Engine named pipe, so no fresh stack or deployed benchmark ran. |
| Historical local Compose verification | Passed for recorded scenarios | See `RELEASE_VERIFICATION.md`: upload completion, worker retries/recovery, owner checks, one deletion, clean startup. These are prior recorded results, not rerun for this snapshot. |
| Performance benchmark | Not run | No hardware, dataset, concurrency, or repeatable baseline was established; no performance claims are made. |

The repository's integration tests are useful coverage, but a checked-in test file is not itself proof that the test passed. The release checklist also records deferred production/CD checks and a partially unresolved verification-script assertion issue.

## Reproduce

With backend dependencies installed and required PostgreSQL/Redis/R2 test configuration available:

```powershell
cd BE
npm test
```

For a meaningful upload benchmark, record file size/type, client and server hardware, network, concurrency, successful completion count, throughput, and p50/p95 duration; repeat against a stated baseline. Until then, describe supported upload sizes and implemented retries rather than speed gains.
