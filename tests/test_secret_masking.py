from app.security.secrets import mask_http_headers, mask_secrets, mask_secrets_and_pem


def test_mask_secrets_masks_nested_sensitive_values():
    payload = {
        "basic_password": "pw",
        "auth": {
            "token": "abc",
            "client_secret": "secret",
            "normal": "ok",
        },
        "items": [{"api_key_value": "k"}, {"password": "p"}],
    }
    out = mask_secrets(payload)
    assert out["basic_password"] == "********"
    assert out["auth"]["token"] == "********"
    assert out["auth"]["client_secret"] == "********"
    assert out["auth"]["normal"] == "ok"
    assert out["items"][0]["api_key_value"] == "********"
    assert out["items"][1]["password"] == "********"


def test_mask_secrets_masks_access_key():
    out = mask_secrets({"access_key": "AKIAIOSFODNN7EXAMPLE"})
    assert out["access_key"] == "********"


def test_mask_secrets_and_pem_strips_inline_pem():
    pem = "-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----"
    out = mask_secrets_and_pem({"note": pem, "x": 1})
    assert out["note"] == "********"
    assert out["x"] == 1


def test_mask_http_headers_masks_sensitive_headers():
    masked = mask_http_headers(
        {
            "Authorization": "Bearer secret-token",
            "Cookie": "session=abc",
            "X-API-Key": "super-secret",
            "Accept": "application/json",
        }
    )
    assert masked["Authorization"] == "********"
    assert masked["Cookie"] == "********"
    assert masked["X-API-Key"] == "********"
    assert masked["Accept"] == "application/json"


def test_mask_credential_url_and_merge_preserve():
    from app.security.secrets import mask_credential_url, merge_preserving_masked_secrets

    assert mask_credential_url("https://u:p@host/x") == "https://u:********@host/x"
    merged = merge_preserving_masked_secrets(
        {"password": "********", "name": "n"},
        {"password": "real-secret", "name": "old"},
    )
    assert merged["password"] == "real-secret"
    assert merged["name"] == "n"


def test_mask_secrets_masks_shared_secret():
    out = mask_secrets({"shared_secret": "shh", "ok": 1})
    assert out["shared_secret"] == "********"
    assert out["ok"] == 1
