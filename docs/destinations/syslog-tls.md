# Syslog TLS Destination

This document describes how to configure and operate the `SYSLOG_TLS` runtime
destination type. See `specs/024-syslog-tls-destination/spec.md` for the full
spec contract.

`SYSLOG_TLS` is a runtime delivery destination only. It is unrelated to the
browser HTTPS reverse proxy described in spec 021 — this document does not
change that proxy.

## When to use

Use `SYSLOG_TLS` when the receiving SIEM/syslog endpoint is configured for
RFC5425-style syslog over TCP+TLS (typically on port 6514). For unencrypted
delivery use `SYSLOG_TCP` or `SYSLOG_UDP` as before.

## Destination configuration

`destinations.config_json` keys for `SYSLOG_TLS`:

| Key                      | Required | Default  | Notes                                                                 |
|--------------------------|----------|----------|-----------------------------------------------------------------------|
| `host`                   | yes      | —        | Receiver hostname or IP                                               |
| `port`                   | yes      | —        | Typically `6514`                                                      |
| `tls_enabled`            | yes      | `true`   | Must be `true`. Stored explicitly so audit snapshots are clear        |
| `tls_verify_mode`        | no       | `strict` | One of `strict`, `insecure_skip_verify`                               |
| `tls_ca_cert_path`       | no       | unset    | Absolute path to a CA bundle (PEM) the platform process can read      |
| `tls_client_cert_path`   | no       | unset    | Absolute path to a client cert (PEM) for mutual TLS                   |
| `tls_client_key_path`    | no       | unset    | Absolute path to the client private key (PEM) — required with cert    |
| `tls_server_name`        | no       | `host`   | SNI override; defaults to `host`                                      |
| `connect_timeout`        | no       | `5`      | Seconds                                                               |
| `write_timeout`          | no       | `5`      | Seconds                                                               |

The platform validates these at create/update; non-syslog destinations cannot
include any `tls_*` keys.

## Verification modes

### `strict`

- Verifies the server certificate against the system CA bundle (or the
  optional `tls_ca_cert_path` if you provided one).
- Performs hostname verification against `tls_server_name` (defaulting to
  `host`).
- Rejects expired or untrusted certificates.

### `insecure_skip_verify`

- Disables CA + hostname verification entirely.
- Intended for **lab and local testing only**. The UI shows a persistent warning
  whenever this mode is selected.
- Production runtime should use `strict` with a trusted CA path.

## Generating self-signed certificates for testing

Below is a quick recipe for a local lab certificate. Copy it onto the platform
host and reference the resulting paths in the destination config.

```bash
mkdir -p /etc/gdc/tls
cd /etc/gdc/tls

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout server.key \
  -out    server.crt \
  -subj '/CN=siem.lab.local' \
  -addext 'subjectAltName=DNS:siem.lab.local,DNS:localhost,IP:127.0.0.1' \
  -days 365
chmod 600 server.key
```

Configure the destination:

```json
{
  "host": "siem.lab.local",
  "port": 6514,
  "tls_enabled": true,
  "tls_verify_mode": "strict",
  "tls_ca_cert_path": "/etc/gdc/tls/server.crt"
}
```

For local-only testing without trust setup, switch to:

```json
{
  "host": "127.0.0.1",
  "port": 6514,
  "tls_enabled": true,
  "tls_verify_mode": "insecure_skip_verify"
}
```

## Connectivity test

The destination test endpoint (`POST /api/v1/destinations/{id}/test`) and the
in-form preview test (`POST /api/v1/destinations/preview-test`) both perform a
real TLS handshake and send one syslog line. The result includes:

- `success`: handshake + send result
- `latency_ms`: round-trip duration of the probe
- `detail.protocol`: `"tls"`
- `detail.verify_mode`: the resolved mode
- `detail.negotiated_tls_version`: e.g. `TLSv1.3`
- `detail.cipher`: negotiated cipher name (when OpenSSL exposes it)
- `detail.error_code`: when `success=false`, one of:
  - `TLS_CERT_VERIFY_FAILED`
  - `TLS_HOSTNAME_MISMATCH`
  - `TLS_CERT_EXPIRED`
  - `TLS_CERT_ERROR`
  - `TLS_HANDSHAKE_FAILED`
  - `TLS_CONNECT_REFUSED`
  - `TLS_CONNECT_TIMEOUT`
  - `TLS_CONNECT_FAILED`
  - `TLS_CONFIG_INVALID` / `TLS_CONTEXT_ERROR` / `TLS_FORMAT_ERROR`
  - `TLS_ERROR`

The probe is read-only: it never persists checkpoints, never updates
`delivery_logs`, and never modifies runtime stream state.

## Retry / failure compatibility

`SYSLOG_TLS` failures behave identically to existing destination failures:

- `route_send_failed` is staged and persisted on commit.
- `RETRY_AND_BACKOFF` retries through the same code path.
- `PAUSE_STREAM_ON_FAILURE` pauses the stream.
- `DISABLE_ROUTE_ON_FAILURE` disables the route.
- Checkpoints advance only when all required routes succeed (existing rule).

## Troubleshooting TLS handshake errors

| Symptom in test result                          | Likely cause                                                                                  |
|--------------------------------------------------|-----------------------------------------------------------------------------------------------|
| `Certificate verification failed: hostname mismatch` | The cert SAN/CN does not include `tls_server_name` or `host`. Set `tls_server_name` correctly or reissue the cert. |
| `Certificate verification failed: certificate expired` | Renew the receiver certificate (or its issuing CA chain).                                     |
| `Certificate verification failed: unable to get local issuer certificate` | Provide `tls_ca_cert_path` pointing at the issuing CA bundle, or add the CA to the system trust store. |
| `TLS handshake failed: tlsv1 alert internal error` | Receiver does not support the negotiated TLS version. Confirm the receiver is configured for TLS 1.2+. |
| `TLS connect refused` / `TLS connect timed out` | The receiver port is closed or unreachable. Check firewall / receiver service health.        |

## Example SIEM/syslog TLS setup

A typical SIEM-side configuration for a syslog-tls input that this destination
can deliver to:

- Listener protocol: TCP+TLS (RFC 5425)
- Listener port: 6514
- Server certificate signed by an internal CA
- TLS minimum version: 1.2
- Client cert verification: optional (set `tls_client_cert_path`/
  `tls_client_key_path` if the SIEM requires mutual TLS)

On the platform host, ensure that:

- The certificate paths are readable by the user running the API.
- The CA bundle is mounted/available before stream runs that route to this
  destination.
- The runtime container/host clock is reasonably accurate so that strict
  verification does not reject otherwise-valid certificates.

## What this feature does not change

- The browser-facing nginx reverse proxy (spec 021) is untouched.
- StreamRunner ownership rules and the checkpoint-after-delivery rule are
  unchanged.
- Retry/backoff/disable/pause policies are unchanged.
- Validation Lab isolation is unchanged.
