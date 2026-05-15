# 029 Remote file polling source (REMOTE_FILE_POLLING)

## Purpose

Define **REMOTE_FILE_POLLING**: poll files from remote hosts over **SFTP** or **SCP**, parse bodies into events, and feed the standard stream pipeline. **Checkpoints advance only after successful destination delivery** (`specs/002-runtime-pipeline/spec.md`). This spec is roadmap-only: no runtime or StreamRunner behavior changes are required by this document.

## Non-goals

- Oracle, MSSQL, Kafka, message queues.
- Cloud object storage beyond existing **S3_OBJECT_POLLING** (no S3/GCS/Azure extensions here).
- In-band malware scanning or AV pipeline (out of scope unless a separate security spec is added).

## Architecture alignment

- **Source adapter isolation** (`specs/001-core-architecture/spec.md`): SSH/SFTP/SCP wire logic and parsers live in dedicated adapter modules behind `SourceAdapterRegistry`.
- **Connector ≠ Stream**: host auth and host-key policy live with the source/connector; directory patterns, parsers, and per-run caps live on the stream.
- **English-only** product language for UI, APIs, logs, and normative spec text (`.specify/memory/constitution.md`).

## Source type

- **source_type**: `REMOTE_FILE_POLLING`

## Supported protocols

| Protocol | Notes |
| --- | --- |
| **SFTP** | Primary mode for listing, stat, and ranged reads. |
| **SCP** | Optional path for full-file copy when SFTP is unavailable; listing semantics may be weaker—implementation must document constraints (e.g. directory listing via SFTP fallback or explicit manifest). |

If SCP cannot support safe incremental listing, the implementation must **require SFTP for incremental polling** or restrict SCP to explicit file paths (future stream field)—this choice is decided at implementation time and documented in the adapter README.

## Connection configuration

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `host` | string | yes | Remote hostname or IP. |
| `port` | integer | yes | SSH port (default 22). |
| `username` | string | yes | SSH user. |
| `password` | secret string | one-of | Password authentication when not using key-only auth. |
| `private_key` | secret PEM | one-of | Private key material; never returned in GET APIs; UI masks as `********` when set. |
| `private_key_passphrase` | secret string | no | Passphrase for encrypted private keys. |
| `known_hosts_policy` | enum | yes | e.g. `STRICT_FILE`, `ACCEPT_NEW`, `INSECURE_DISABLE_VERIFICATION` (last reserved for lab-only; UI must warn). |
| `connection_timeout_seconds` | integer | yes | TCP + SSH handshake bound. |

## Stream configuration

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `remote_directory` | string | yes | Root path to poll. |
| `file_pattern` | glob string | yes | e.g. `*.ndjson`, `logs/app-*.json`. |
| `recursive` | boolean | yes | Whether to traverse subdirectories. |
| `parser_type` | enum | yes | One of: `NDJSON`, `JSON_ARRAY`, `JSON_OBJECT`, `CSV`, `LINE_DELIMITED_TEXT`. |
| `max_files_per_run` | integer ≥ 1 | yes | Cap files processed per run after checkpoint ordering. |
| `max_file_size_mb` | integer ≥ 1 | yes | Refuse or truncate policy TBD at implementation: default **refuse** with structured error when exceeded. |

## Supported parsers

| `parser_type` | Behavior |
| --- | --- |
| `NDJSON` | One JSON object per non-empty line; invalid lines skipped or strict mode (mirror S3 NDJSON policy in `docs/sources/s3-object-polling.md`). |
| `JSON_ARRAY` | Single JSON array of objects; reject non-object elements. |
| `JSON_OBJECT` | Single JSON object per file yields one event unless configured otherwise. |
| `CSV` | Header row required; each row → one event with column keys from header. |
| `LINE_DELIMITED_TEXT` | Each non-empty line → one event `{ "line": "..." }` or configurable single field name at implementation. |

## Checkpoint model (logical fields)

Aligned with object polling concepts (`docs/sources/s3-object-polling.md`, S3 adapter metadata). Values are persisted only via the same **post-delivery** checkpoint path as today:

| Field | Description |
| --- | --- |
| `last_processed_file` | Remote path / name of the last fully delivered file in ordering. |
| `last_processed_mtime` | Modification time from remote `stat` when available. |
| `last_processed_size` | File size in bytes at processing time. |
| `last_processed_offset` | Byte offset for partial-file resume when parser supports resume (NDJSON / line-delimited). |
| `last_processed_hash` | Optional content hash (e.g. SHA-256) for overwrite detection when policy uses hashing. |

Exact JSON keys in `checkpoint_value` follow the checkpoint service conventions established at implementation time; they must remain compatible with checkpoint trace (`specs/010-checkpoint-trace/spec.md`).

## File mutation handling

1. **Overwrite detection**: if `mtime`, `size`, or `hash` changes for a path already considered processed, the file is treated as **new content** for incremental purposes; the adapter re-reads according to policy (from offset 0 or full replace).
2. **Rotated files**: when `file_pattern` matches a new path (e.g. dated suffix), ordering must be deterministic (lexicographic path + mtime tie-break). Rotated-away files are not re-fetched unless they reappear in listing.
3. **Deleted-before-fetch**: if a file disappears between list and open, the run records a structured skip/error without advancing checkpoint for that file’s pending events; partial batches follow StreamRunner partial-failure semantics.

## Security

- **No secret logging**: never log `password`, `private_key`, `private_key_passphrase`, or host key material.
- **Host key verification**: `known_hosts_policy` defaults to strict in production documentation; insecure modes require explicit operator opt-in and UI warning.
- **Private key masking**: same masking rules as other secrets in API responses and UI.
- **Least privilege**: recommend dedicated read-only account with chrooted or minimal directory ACLs.

## Rate limiting

- **Source** and **destination** rate limits are independent (`constitution.md`).

## Testing strategy

- **Unit tests**: parser matrix, pattern matching, `max_files_per_run`, size limit, mutation detection logic with mocked file metadata.
- **Integration tests**: OpenSSH test container or fixture SFTP server; overwrite and rotation scenarios; checkpoint does not move on failed delivery (reuse patterns from `tests/test_s3_stream_runner_checkpoint.py` philosophy).
- **Security tests**: known_hosts strict mode; verify no secrets in structured logs.

## Documentation

Operator runbook pages under `docs/sources/remote-file-polling.md` (to be added with implementation).
