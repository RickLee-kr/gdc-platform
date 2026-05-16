"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment / .env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "Generic Data Connector Platform API"
    APP_ENV: str = "development"
    API_PREFIX: str = "/api/v1"
    DATABASE_URL: str = "postgresql://gdc:gdc@127.0.0.1:55432/datarelay"

    # SQLAlchemy pool (moderate defaults; tune per host RAM / expected concurrency).
    GDC_DB_POOL_SIZE: int = 5
    GDC_DB_MAX_OVERFLOW: int = 8
    GDC_DB_POOL_TIMEOUT: int = 30
    GDC_DB_POOL_RECYCLE_SEC: int = 3600
    # Log individual statement timings over thresholds (see app/observability/slow_query.py).
    GDC_SLOW_QUERY_LOG: bool = True
    SECRET_KEY: str = "change-me-in-production"
    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_ISSUER: str = "gdc-platform"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    REQUIRE_AUTH: bool = False
    AUTH_DEV_HEADER_TRUST: bool = False
    ENCRYPTION_KEY: str = "replace-with-fernet-or-aes-key-placeholder"
    DEFAULT_COLLECTOR_NAME: str = "generic-connector-01"

    # Optional WEBHOOK_POST echo for continuous validation (`/api/v1/validation/echo?key=...`).
    VALIDATION_ECHO_QUERY_KEY: str | None = None
    VALIDATION_ECHO_HEADER_VALUE: str | None = None
    # Background supervisor interval for continuous validation scheduler (seconds).
    VALIDATION_SUPERVISOR_INTERVAL_SEC: float = 20.0

    # Optional absolute UI base for validation deep links in outbound notifications (no trailing slash).
    PLATFORM_PUBLIC_UI_BASE_URL: str = ""
    # Comma-separated outbound notification targets (fail-open; never blocks StreamRunner).
    VALIDATION_ALERT_NOTIFY_GENERIC_URLS: str = ""
    VALIDATION_ALERT_NOTIFY_SLACK_URLS: str = ""
    VALIDATION_ALERT_NOTIFY_PAGERDUTY_ROUTING_KEYS: str = ""

    # Development validation lab (additive WireMock-backed entities; never enable in production).
    ENABLE_DEV_VALIDATION_LAB: bool = False
    DEV_VALIDATION_AUTO_START: bool = False
    DEV_VALIDATION_WIREMOCK_BASE_URL: str = "http://127.0.0.1:18080"
    DEV_VALIDATION_WEBHOOK_BASE_URL: str = "http://127.0.0.1:18091"
    DEV_VALIDATION_SYSLOG_HOST: str = "127.0.0.1"
    DEV_VALIDATION_SYSLOG_PORT: int = 15514

    # Optional MinIO S3 lab slice (requires credentials; never enable in production).
    ENABLE_DEV_VALIDATION_S3: bool = False
    MINIO_ENDPOINT: str = "http://127.0.0.1:9000"
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    MINIO_BUCKET: str = "gdc-test-logs"

    # Optional lab slices for DATABASE_QUERY / REMOTE_FILE_POLLING / perf snapshots (never enable in production).
    ENABLE_DEV_VALIDATION_DATABASE_QUERY: bool = False
    ENABLE_DEV_VALIDATION_REMOTE_FILE: bool = False
    ENABLE_DEV_VALIDATION_PERFORMANCE: bool = False

    # Isolated fixture DB / SSH endpoints (customer DB simulation — not the platform catalog).
    DEV_VALIDATION_PG_QUERY_HOST: str = "127.0.0.1"
    DEV_VALIDATION_PG_QUERY_PORT: int = 55433
    DEV_VALIDATION_MYSQL_QUERY_HOST: str = "127.0.0.1"
    DEV_VALIDATION_MYSQL_QUERY_PORT: int = 33306
    DEV_VALIDATION_MARIADB_QUERY_HOST: str = "127.0.0.1"
    DEV_VALIDATION_MARIADB_QUERY_PORT: int = 33307
    DEV_VALIDATION_SFTP_HOST: str = "127.0.0.1"
    DEV_VALIDATION_SFTP_PORT: int = 22222
    DEV_VALIDATION_SFTP_USER: str = "gdc"
    DEV_VALIDATION_SFTP_PASSWORD: str = ""
    DEV_VALIDATION_SSH_SCP_HOST: str = "127.0.0.1"
    DEV_VALIDATION_SSH_SCP_PORT: int = 22223
    DEV_VALIDATION_SSH_SCP_USER: str = "gdc2"
    DEV_VALIDATION_SSH_SCP_PASSWORD: str = ""

    # Self-signed TLS material paths (relative paths resolve from process working directory).
    GDC_TLS_CERT_PATH: str = "data/tls/server.crt"
    GDC_TLS_KEY_PATH: str = "data/tls/server.key"

    # PEM paths as seen by the reverse proxy container (for generated nginx config).
    GDC_NGINX_TLS_CERT_CONTAINER_PATH: str = "/var/gdc/tls/server.crt"
    GDC_NGINX_TLS_KEY_CONTAINER_PATH: str = "/var/gdc/tls/server.key"

    # Operator-written nginx site config (bind-mount this path into the proxy conf.d directory).
    GDC_NGINX_CONF_PATH: str = "data/nginx/default.conf"
    # Upstream API hostname:port used inside generated nginx config (Docker DNS name is typical).
    GDC_UPSTREAM_API_HOST: str = "127.0.0.1"
    GDC_UPSTREAM_API_PORT: int = 8000
    # Static UI (Vite build) served by the optional ``frontend`` compose service.
    GDC_UPSTREAM_UI_HOST: str = "frontend"
    GDC_UPSTREAM_UI_PORT: int = 80

    # Optional: POST target to trigger ``nginx -t`` + ``nginx -s reload`` inside the proxy container.
    GDC_PROXY_RELOAD_URL: str = ""
    GDC_PROXY_RELOAD_TOKEN: str = ""

    # Published browser ports (for Admin Settings URL hints when behind port-mapped compose).
    GDC_PUBLIC_HTTP_PORT: int = 0
    GDC_PUBLIC_HTTPS_PORT: int = 0

    # Optional: HTTP GET health URL for the reverse proxy (e.g. http://reverse-proxy/health).
    GDC_PROXY_INTERNAL_HEALTH_URL: str = ""

    # Operational retention overrides (PostgreSQL batch cleanup). None = use built-in defaults.
    GDC_RETENTION_BACKFILL_JOBS_DAYS: int | None = None
    GDC_RETENTION_BACKFILL_PROGRESS_EVENTS_DAYS: int | None = None
    GDC_RETENTION_VALIDATION_SNAPSHOTS_DAYS: int | None = None
    # Dedicated supplement scheduler tick (backfill + validation snapshots); default daily.
    GDC_OPERATIONAL_RETENTION_INTERVAL_SEC: float = 86400.0
    # Background thread for supplement bundle (no Celery). Disable in constrained tests.
    GDC_OPERATIONAL_RETENTION_SUPPLEMENT_ENABLED: bool = True

    # When True, trust ``X-Forwarded-Proto`` / ``X-Forwarded-For`` from ``GDC_PROXY_FORWARD_TRUSTED_HOSTS``.
    # Enable behind the bundled nginx reverse proxy; keep False for direct local API exposure.
    GDC_TRUST_PROXY_HEADERS: bool = False
    GDC_PROXY_FORWARD_TRUSTED_HOSTS: str = "*"


settings = Settings()
