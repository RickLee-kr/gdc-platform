import type { ConnectorWritePayload } from '../../api/gdcConnectors'

/** Same merged shape as backend `_flatten_source_row` for `inline_flat_source` on connector auth test. */
export function connectorWritePayloadToInlineFlatSource(form: ConnectorWritePayload): Record<string, unknown> {
  const st = String(form.source_type ?? 'HTTP_API_POLLING').toUpperCase()
  if (st === 'S3_OBJECT_POLLING') {
    return {
      source_type: 'S3_OBJECT_POLLING',
      endpoint_url: String(form.endpoint_url ?? '').trim(),
      bucket: String(form.bucket ?? '').trim(),
      region: String(form.region ?? 'us-east-1').trim() || 'us-east-1',
      access_key: String(form.access_key ?? '').trim(),
      secret_key: String(form.secret_key ?? '').trim(),
      prefix: String(form.prefix ?? '').trim(),
      path_style_access: form.path_style_access !== false,
      use_ssl: form.use_ssl === true,
      auth_type: 'no_auth',
    }
  }
  if (st === 'DATABASE_QUERY') {
    return {
      source_type: 'DATABASE_QUERY',
      db_type: String(form.db_type ?? 'POSTGRESQL').trim().toUpperCase(),
      host: String(form.host ?? '').trim(),
      port: typeof form.port === 'number' && form.port > 0 ? form.port : undefined,
      database: String(form.database ?? '').trim(),
      username: String(form.db_username ?? '').trim(),
      password: String(form.db_password ?? ''),
      ssl_mode: String(form.ssl_mode ?? 'PREFER').trim().toUpperCase(),
      connection_timeout_seconds:
        typeof form.connection_timeout_seconds === 'number' ? form.connection_timeout_seconds : 15,
      auth_type: 'no_auth',
    }
  }
  if (st === 'REMOTE_FILE_POLLING') {
    return {
      source_type: 'REMOTE_FILE_POLLING',
      connector_type: 'remote_file',
      host: String(form.host ?? '').trim(),
      port: typeof form.port === 'number' && form.port > 0 ? form.port : 22,
      remote_username: String(form.remote_username ?? '').trim(),
      remote_password: String(form.remote_password ?? ''),
      remote_file_protocol: (() => {
        const p = String(form.remote_file_protocol ?? 'sftp').toLowerCase()
        return p === 'scp' ? 'sftp_compatible_scp' : p
      })(),
      remote_private_key: String(form.remote_private_key ?? ''),
      remote_private_key_passphrase: String(form.remote_private_key_passphrase ?? ''),
      known_hosts_policy: String(form.known_hosts_policy ?? 'strict'),
      known_hosts_text: String(form.known_hosts_text ?? ''),
      connection_timeout_seconds:
        typeof form.connection_timeout_seconds === 'number' ? form.connection_timeout_seconds : 20,
      auth_type: 'no_auth',
    }
  }
  return {
    base_url: String(form.base_url ?? form.host ?? '').trim(),
    verify_ssl: form.verify_ssl !== false,
    http_proxy: form.http_proxy?.trim() ? form.http_proxy.trim() : null,
    headers: { ...(form.common_headers ?? {}) },
    auth_type: form.auth_type ?? 'no_auth',
    basic_username: form.basic_username ?? '',
    basic_password: form.basic_password ?? '',
    bearer_token: form.bearer_token ?? '',
    api_key_name: form.api_key_name ?? '',
    api_key_value: form.api_key_value ?? '',
    api_key_location: form.api_key_location ?? 'headers',
    oauth2_client_id: form.oauth2_client_id ?? '',
    oauth2_client_secret: form.oauth2_client_secret ?? '',
    oauth2_token_url: form.oauth2_token_url ?? '',
    oauth2_scope: form.oauth2_scope ?? '',
    login_url: form.login_url ?? '',
    login_path: form.login_path ?? '',
    login_method: form.login_method ?? 'POST',
    login_headers: form.login_headers ?? {},
    login_body_template: form.login_body_template ?? {},
    login_body_mode: form.login_body_mode ?? 'json',
    login_body_raw: form.login_body_raw ?? '',
    login_allow_redirects: form.login_allow_redirects ?? false,
    session_cookie_name: form.session_cookie_name ?? '',
    login_username: form.login_username ?? '',
    login_password: form.login_password ?? '',
    preflight_enabled: form.preflight_enabled ?? false,
    preflight_method: form.preflight_method ?? 'GET',
    preflight_path: form.preflight_path ?? '',
    preflight_url: form.preflight_url ?? '',
    preflight_headers: form.preflight_headers ?? {},
    preflight_body_raw: form.preflight_body_raw ?? '',
    preflight_follow_redirects: form.preflight_follow_redirects ?? false,
    login_query_params: form.login_query_params ?? {},
    session_login_extractions: form.session_login_extractions ?? [],
    csrf_extract: form.csrf_extract ?? null,
    refresh_token: form.refresh_token ?? '',
    token_url: form.token_url ?? '',
    token_path: form.token_path ?? '',
    token_http_method: form.token_http_method ?? 'POST',
    refresh_token_header_name: form.refresh_token_header_name ?? 'Authorization',
    refresh_token_header_prefix: form.refresh_token_header_prefix ?? 'Bearer',
    access_token_json_path: form.access_token_json_path ?? '$.access_token',
    access_token_header_name: form.access_token_header_name ?? 'Authorization',
    access_token_header_prefix: form.access_token_header_prefix ?? 'Bearer',
    token_ttl_seconds: form.token_ttl_seconds ?? 600,
    user_id: form.user_id ?? '',
    api_key: form.api_key ?? '',
    token_method: form.token_method ?? 'POST',
    token_auth_mode: form.token_auth_mode ?? 'basic_user_api_key',
    token_content_type: form.token_content_type ?? null,
    token_body_mode: form.token_body_mode ?? 'empty',
    token_body: form.token_body ?? '',
    access_token_injection: form.access_token_injection ?? 'bearer_authorization',
    access_token_query_name: form.access_token_query_name ?? '',
    token_custom_headers: form.token_custom_headers ?? {},
  }
}
