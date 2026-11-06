# Demo execution and deployment contract

This is the implementation target, not a claim that hosting or a worker already exists.

## Target and ownership

- Target one GMI Cloud Linux VM with a persistent disk, Docker Compose, and HTTPS. Verify account/VM access and classifier credentials in the first 10 minutes. If that target is unavailable by the deployment timebox, retain the explicitly labeled local fixture demo and mark deployment incomplete; do not silently change the hosting design during integration.
- Run two services from one application image: a FastAPI process serving the API and built React assets, and one worker process. Same-origin UI/API avoids a separate CORS setup. A reverse proxy terminates HTTPS. Use one VM/worker replica for this release; no Redis, GPU, or distributed queue is required.
- Persist SQLite in WAL mode, run artifacts, raw response checkpoints, and classification/asset caches on the same local disk volume under `/data`. Back up the volume before the demo. Filesystem persistence covers process/container restarts; VM/disk loss requires restoration from backup.
- The fetch owner implements the queue/API/worker; the UI owner owns polling, review, and deployment wiring. Server-only credentials come from deployment environment variables. Protect analysis/review operations with a small shared demo login using a secure session cookie; a full user-account system remains out of scope.

## Endpoints and idempotency

| Endpoint | Contract |
|---|---|
| `POST /api/runs` | Authenticated. Body `{campaign, options}`; require `Idempotency-Key`. Validate fully before enqueueing or making paid requests. Return `202` with `{runId, state, statusUrl, resultUrl}` for a new run. |
| `GET /api/runs/{id}` | Read only: active state, stage (`queued/fetch/classify/metrics/review/done`), counters, heartbeat, warnings, target revision, published revision/state, and artifact availability. No provider calls. |
| `GET /api/runs/{id}/result` | Return the validated version-2 board envelope when published; `409` with current state if no board exists. A partial board must retain its partial metadata. |
| `POST /api/runs/{id}/reviews` | Authenticated, completed run only. Body includes video ID, accept/reject decision, reason, and expected result revision. Store audited decisions and enqueue a rebuild using saved records; never refetch Oriane. Revision mismatch returns `409`. |

- Scope the idempotency key to the authenticated demo principal. Within one SQLite transaction, bind it to a hash of canonical normalized campaign + options, including content/prompt versions and selected assets. A repeat with the same payload returns the existing run, even if terminal; a different payload with the same key returns `409`. Unique database constraints prevent simultaneous duplicate starts.
- Default options: at most 50 Oriane search attempts, 10 asset-creation attempts, 1,000 unique accepted/candidate records, and 100 accepted classification records per run. Retries count toward request budgets. Count every model attempt against a separate 200-attempt budget. Reaching a budget yields partial metadata, not silent completion. Surface the planned scope and configured caps before the user starts.
- One active worker job; at most two queued analysis/rebuild jobs. Return `429` when full. Classifier concurrency is initially 4, with at most 2 attempts per item; Oriane requests run serially, with at most 3 attempts for a transient failure. Honor retry-after within the configured time/budget. These are conservative demo configuration defaults, not provider limits.
- An explicit refresh submits a new idempotency key. An explicit retry of an interrupted run creates a new run referencing the old checkpoints, reuses validated completed stages/cache entries, and makes any new paid work visible. Duplicate clicks and browser refreshes never imply new paid work.

## Worker lifecycle and recovery

States: `queued → running → succeeded | partial | failed | interrupted`. Reviews move a terminal succeeded/partial run back through queued/running for a versioned rebuild; the last published revision remains readable until its replacement is complete. Only one rebuild/analysis job may own a run at a time.

1. The worker holds an exclusive OS lock on the shared volume so a second worker cannot start. It claims a queued job with a SQLite transaction and records a worker ID, ownership token, heartbeat, and lease expiry. All checkpoint/finalization writes compare ownership tokens and expected states.
2. Heartbeat every 10 seconds with a 60-second lease. Provider timeouts are bounded; heartbeat execution is independent of a blocked network request. Docker restarts crashed processes. A process health watchdog terminates a worker that loses its heartbeat so it releases its OS lock.
3. Persist each raw page and normalized checkpoint with query identity, raw offset, relevant visual anchor, and query parameters. Atomically rename completed artifact files, then commit the database pointer/revision. Orphan files from a crash are not published results.
4. On startup, reconcile previously running jobs as interrupted after establishing exclusive ownership; on an expired lease, the status handler may mark the run interrupted using a compare-and-swap update. The old owner cannot publish a later success after that state/token changes. Queued jobs remain queued and are eligible for processing.
5. Do not automatically replay interrupted paid requests. Their provider-side completion can be unknown. Keep completed checkpoints, explain the interruption, and require an explicit retry action. Reuse only checkpoints with matching input/version hashes; if a visual anchor is no longer usable, warn that a new search is needed.
6. `succeeded` requires completed requested retrieval, every accepted classification classified or no-evidence, and no unresolved candidates. `partial` requires a usable published board with unfinished retrieval/classification or unresolved candidates. `failed` means no usable board could be produced for this attempt. Interrupted or failed rebuilds retain previous published revisions, with current attempt state shown separately; they are never shown as currently running forever.
7. Reviews can accept candidates whose classification is not cached. Disclose that rebuilding may use the classifier budget; cap it just like an analysis. Until rebuild publication, display the previous board with a pending-review banner and suppress affected recommendations. Serialize reviews or reject overlapping ones with `409`.

## Deployment acceptance checks

- Two simultaneous start requests with the same key create one run and one set of provider calls; conflicting payloads produce `409`.
- Status/result polling and browser refresh issue zero provider calls.
- Kill the worker after a saved page, after an external response but before its checkpoint, and during finalization. On restart, affected runs become interrupted, the prior completed board remains readable, and no paid work is silently replayed.
- A stale owner cannot publish after lease invalidation; a second worker fails to acquire the OS lock.
- Restart API and worker containers and verify SQLite state, run artifacts, and cache persist. Restore a backup to validate the documented recovery path.
- A partial run exposes per-account/channel coverage to metrics and the UI. A completed retrieval containing unresolved visual candidates publishes a partial board with candidates excluded.
- Reject unauthenticated mutation requests, cross-origin mutations, oversized bodies, and queue overflow. Secrets never enter browser assets or API responses. Logs redact authorization headers and provider credentials.
