"""Constants and static templates for the development validation lab (English-only labels)."""

from __future__ import annotations

LAB_NAME_PREFIX = "[DEV VALIDATION] "
LAB_DESCRIPTION = (
    "Development validation lab — auto-seeded synthetic traffic against WireMock and test receivers. "
    "Not for production customer data."
)
LAB_TEMPLATE_KEY_PREFIX = "dev_lab_"

# Stable template_key values (<= 64 chars, unique).
TK_FULL_SINGLE = "dev_lab_full_single"
TK_FULL_ARRAY = "dev_lab_full_array"
TK_FULL_NESTED = "dev_lab_full_nested"
TK_AUTH_EMPTY = "dev_lab_auth_empty"
TK_FETCH_ARRAY = "dev_lab_fetch_array"
TK_FULL_POST = "dev_lab_full_post"
TK_FULL_PAGE = "dev_lab_full_page"
TK_FULL_DELIVERY = "dev_lab_full_delivery"
TK_FULL_VENDOR = "dev_lab_full_vendor"
TK_FULL_OKTA = "dev_lab_full_okta"
TK_FULL_SESSION = "dev_lab_full_session"
TK_AUTH_APIKEY = "dev_lab_auth_apikey"
TK_S3_OBJECT_POLLING = "dev_lab_s3_object_polling"
TK_DB_QUERY_PG = "dev_lab_db_query_pg"
TK_DB_QUERY_MYSQL = "dev_lab_db_query_mysql"
TK_DB_QUERY_MARIADB = "dev_lab_db_query_mariadb"
TK_REMOTE_SFTP = "dev_lab_remote_file_sftp"
TK_REMOTE_SCP = "dev_lab_remote_file_scp"

CONNECTOR_SPECS: tuple[tuple[str, str, dict], ...] = (
    ("Generic REST", "no_auth", {}),
    ("Basic Auth", "basic", {"basic_username": "e2e-basic-user", "basic_password": "e2e-basic-pass"}),
    (
        "API Key",
        "api_key",
        {
            "api_key_name": "X-E2E-Api-Key",
            "api_key_value": "matrix-api-key-secret-value",
            "api_key_location": "headers",
        },
    ),
    ("Bearer", "bearer", {"bearer_token": "template-e2e-generic-bearer"}),
    (
        "Vendor JWT",
        "vendor_jwt_exchange",
        {
            "user_id": "wiremock-user",
            "api_key": "wiremock-secret",
            "token_method": "POST",
            "token_auth_mode": "basic_user_api_key",
            "token_path": "$.access_token",
            "access_token_injection": "bearer_authorization",
            "token_content_type": "application/json",
            "token_body_mode": "json",
        },
    ),
    (
        "OAuth2",
        "oauth2_client_credentials",
        {
            "oauth2_client_id": "okta-e2e-client",
            "oauth2_client_secret": "okta-e2e-secret",
            "oauth2_scope": "",
        },
    ),
    (
        "Session Login",
        "session_login",
        {
            "login_path": "/e2e-session/login",
            "login_method": "POST",
            "login_username": "session-user",
            "login_password": "session-pass-unique-9231",
            "session_cookie_name": "GDCSESS",
        },
    ),
)

DEFAULT_FIELD_MAPPINGS: dict[str, str] = {
    "event_id": "$.id",
    "message": "$.message",
    "severity": "$.severity",
}

OKTA_FIELD_MAPPINGS: dict[str, str] = {
    "event_id": "$.uuid",
    "message": "$.eventType",
    "severity": "$.severity",
}

MALOP_FIELD_MAPPINGS: dict[str, str] = {
    "event_id": "$.id",
    "malop_id": "$.malopId",
    "severity": "$.severity",
    "status": "$.status",
}

DEFAULT_ENRICHMENT: dict[str, str] = {
    "vendor": "DEV_VALIDATION_LAB",
    "product": "WireMockHarness",
    "log_type": "dev_validation_lab",
    "event_source": "dev_validation_lab",
    "collector_name": "dev-validation-lab",
    "tenant": "lab",
}
