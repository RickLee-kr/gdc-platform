# Uvicorn / Gunicorn production guidance

This document complements `docs/deployment/https-reverse-proxy.md`, `docs/docker-platform.md`, and `docs/deployment/install-guide.md`. The API is a **FastAPI (ASGI)** application (`app.main:app`).

## Process model

- **Uvicorn** runs one or more **async workers** (each is a Python process with its own event loop).
- **Gunicorn + UvicornWorker** is a common production pattern: Gunicorn manages multiple Uvicorn worker processes (supervision, graceful reload, `pre_fork` hooks).

## Recommended worker count

Rules of thumb (adjust after measuring CPU, latency, and PostgreSQL connection count):

| Workload | Workers |
|----------|---------|
| Mostly I/O-bound HTTP + moderate DB reads | **(2 × CPU cores) + 1** as an upper starting point, then reduce if DB pool pressure appears. |
| Heavy synchronous CPU in the same process as the API | Prefer **fewer workers** and offload CPU; each worker runs Python bytecode on one core at a time for CPU-bound sections. |
| Many long-lived blocking calls on the event loop | Fix code paths first; extra workers **do not** fix a blocked loop. |

**PostgreSQL connection budget:** each worker holds up to `pool_size + max_overflow` connections from the SQLAlchemy pool (see `app/config.py`: `GDC_DB_POOL_SIZE`, `GDC_DB_MAX_OVERFLOW`). Total API connections ≈ `workers × (pool_size + max_overflow)` plus migrations, scripts, and sidecars—keep below `max_connections` on Postgres with headroom for admin and replication.

## CPU and RAM sizing

- **CPU:** start with **2 vCPU** for small deployments; scale when p95 API latency or scheduler backlog grows under steady load.
- **RAM:** baseline **512 MiB–1 GiB per worker** for the interpreter, ORM metadata, and modest heap; add headroom for large list responses and concurrent JSON parsing. Monitor RSS and OOM kills in orchestration logs.
- **Shared nothing:** each worker has its own memory; **in-process caches** (for example runtime dashboard read cache) are **not** shared across workers—expect cache duplication per process.

## Timeout guidance (stack alignment)

Align timeouts from the browser/proxy through the app to the database so clients fail predictably instead of hanging.

| Layer | Suggested direction |
|-------|---------------------|
| **Reverse proxy** (`proxy_read_timeout`, `proxy_send_timeout`, load balancer idle timeout) | **≥** maximum expected API duration for slow reads (e.g. large exports), but finite. Typical range **60–120s** for interactive UI; shorter for public APIs. |
| **Gunicorn** `timeout` | Slightly **above** proxy read timeout if the proxy is closer to the client, or match orchestrator kill grace. |
| **Uvicorn** (when run standalone) | Same idea as Gunicorn worker timeout—bounded. |
| **PostgreSQL `statement_timeout`** | Bounded reads use `SET LOCAL` in `get_db_read_bounded` (see `app/database.py`); keep application proxy timeout **greater than** worst-case statement timeout if you want the DB to cancel first and return a controlled error. |
| **Frontend** | The SPA uses per-request JSON timeouts for dashboard reads (see `frontend/src/api.ts`); keep proxy timeout **≥** those ceilings. |

**Example:** proxy `proxy_read_timeout 90s`, Gunicorn `timeout 95`, DB statement timeout 8s for bounded reads → slow queries fail in the DB layer while the client still has time to receive a JSON error body.

## Reverse proxy timeout alignment

1. Pick the **slowest legitimate** request path (large list GET, admin export, etc.).
2. Set **proxy idle/read timeouts** to cover p99 of that path with margin.
3. Set **worker process timeout** ≥ proxy timeout (or accept that the proxy may close first).
4. Ensure **health checks** (`GET /health`) stay well below all of the above so orchestrators do not flap.

Nginx variables of interest are documented in `docs/deployment/https-reverse-proxy.md` and `docker/reverse-proxy/nginx.conf`.

## Example commands (illustrative)

**Uvicorn (single worker, behind a proxy terminating TLS):**

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-keep-alive 5
```

**Gunicorn with Uvicorn workers (adjust paths and venv):**

```bash
gunicorn app.main:app \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers 4 \
  --timeout 90 \
  --graceful-timeout 30 \
  --keep-alive 5
```

Tune `--workers` and `--timeout` to your CPU count, pool settings, and proxy limits. Prefer **structured logs** and **DB pool metrics** over guessing.

## Related configuration

- SQLAlchemy pool: `GDC_DB_POOL_*` in `.env` / `app/config.py`.
- Slow statement logging: `GDC_SLOW_QUERY_LOG` and `app/observability/slow_query.py`.
- Operational retention: `docs/operations/retention-policies.md`.
