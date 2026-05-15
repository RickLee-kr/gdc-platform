# Remote file polling (`REMOTE_FILE_POLLING`)

`REMOTE_FILE_POLLING` streams read files from a remote host over SSH. The connector stores host authentication and host-key policy; the stream stores directory patterns, parser options, and per-run caps.

## Protocols

| Mode | Behavior |
| --- | --- |
| `sftp` | Directory listing, `stat`, and reads use SFTP. |
| `sftp_compatible_scp` | Same listing/metadata path as SFTP; file bytes are fetched with `SCPClient` (paramiko). This is **not** standalone RFC SCP directory polling. Legacy persisted value `scp` is normalized to `sftp_compatible_scp`. |

## Connector fields (API / UI)

| Field | Notes |
| --- | --- |
| `host`, `port`, `username` | SSH target. API write uses `remote_username` merged into stored `username`. |
| `password`, `private_key`, `private_key_passphrase` | Stored in `Source.config_json`; never returned in plaintext from GET (masked in UI). |
| `protocol` | `sftp` or `sftp_compatible_scp`. |
| `known_hosts_policy` | `strict`, `accept_new_for_dev_only`, or `insecure_skip_verify` (lab only). |
| `known_hosts_text` | Optional extra known_hosts lines (OpenSSH format). |
| `connection_timeout_seconds` | TCP + SSH handshake bound. |

### Host keys

- **strict**: server key must match `known_hosts_text` and/or system `known_hosts`.
- **accept_new_for_dev_only**: unseen keys are learned automatically — development only.
- **insecure_skip_verify**: disables verification — **lab only**.

Example (run from a trusted admin workstation, adjust host/port):

```bash
ssh-keyscan -p 22 example.host | sort -u
```

## Stream fields

| Field | Description |
| --- | --- |
| `remote_directory` | Root path to poll. |
| `file_pattern` | Glob (e.g. `*.ndjson`). |
| `recursive` | Traverse subdirectories. |
| `parser_type` | `NDJSON`, `JSON_ARRAY`, `JSON_OBJECT`, `CSV`, `LINE_DELIMITED_TEXT`. |
| `max_files_per_run` | Cap per run. |
| `max_file_size_mb` | Oversized files are skipped with structured logs. |
| `encoding`, `csv_delimiter`, `line_event_field`, `include_file_metadata` | Parser / metadata options. |

## Checkpoints

After successful destination delivery, the runtime checkpoint may include:

- `last_processed_file` (and `last_processed_key` for compatibility)
- `last_processed_mtime` (and `last_processed_last_modified`)
- `last_processed_size`, `last_processed_offset`, `last_processed_hash`

S3 object polling checkpoints keep `last_processed_key` / `last_processed_last_modified` / `last_processed_etag` unchanged.

## Connectivity test

`POST /api/v1/runtime/api-test/connector-auth` with `remote_file_stream_config` returns booleans for SSH reachability, authentication, SFTP availability, directory access, matched file count, sample paths, and host-key status — **no secrets**.

## Related specs

- `specs/029-remote-file-polling-source/spec.md`
- `specs/002-runtime-pipeline/spec.md` (checkpoint after delivery)
