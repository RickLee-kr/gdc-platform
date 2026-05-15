import { GDC_DEFAULT_READ_JSON_TIMEOUT_MS, requestJson, safeRequestJson } from '../api'
import { GDC_API_PREFIX } from './gdcApiPrefix'

const readJsonOpts = { timeoutMs: GDC_DEFAULT_READ_JSON_TIMEOUT_MS }

export type ConnectorRead = {
  id: number
  name: string
  description: string | null
  status: string | null
  connector_type: 'generic_http' | 's3_compatible' | 'relational_database' | 'remote_file'
  source_type: 'HTTP_API_POLLING' | 'S3_OBJECT_POLLING' | 'DATABASE_QUERY' | 'REMOTE_FILE_POLLING'
  source_id: number | null
  stream_count: number
  host: string | null
  base_url: string | null
  verify_ssl: boolean
  http_proxy: string | null
  common_headers: Record<string, string>
  auth_type:
    | 'no_auth'
    | 'basic'
    | 'bearer'
    | 'api_key'
    | 'oauth2_client_credentials'
    | 'session_login'
    | 'jwt_refresh_token'
    | 'vendor_jwt_exchange'
  auth: Record<string, unknown>
  created_at?: string | null
  updated_at?: string | null
  endpoint_url?: string | null
  bucket?: string | null
  region?: string | null
  prefix?: string | null
  path_style_access?: boolean | null
  use_ssl?: boolean | null
  access_key?: string | null
  secret_key_configured?: boolean | null
  db_type?: string | null
  database?: string | null
  port?: number | null
  db_username?: string | null
  db_password_configured?: boolean | null
  ssl_mode?: string | null
  connection_timeout_seconds?: number | null
  remote_username?: string | null
  remote_password_configured?: boolean | null
  known_hosts_policy?: string | null
    remote_file_protocol?: 'sftp' | 'sftp_compatible_scp' | 'scp' | string | null
  remote_private_key_configured?: boolean | null
  remote_private_key_passphrase_configured?: boolean | null
  known_hosts_configured?: boolean | null
}

export type ConnectorWritePayload = {
  name?: string | null
  description?: string | null
  status?: string | null
  connector_type?: 'generic_http' | 's3_compatible' | 'relational_database' | 'remote_file'
  source_type?: 'HTTP_API_POLLING' | 'S3_OBJECT_POLLING' | 'DATABASE_QUERY' | 'REMOTE_FILE_POLLING'
  host?: string | null
  base_url?: string | null
  verify_ssl?: boolean
  http_proxy?: string | null
  common_headers?: Record<string, string>
  endpoint_url?: string | null
  bucket?: string | null
  region?: string | null
  access_key?: string | null
  secret_key?: string | null
  prefix?: string | null
  path_style_access?: boolean | null
  use_ssl?: boolean | null
  db_type?: 'POSTGRESQL' | 'MYSQL' | 'MARIADB' | string | null
  database?: string | null
  port?: number | null
  db_username?: string | null
  db_password?: string | null
  ssl_mode?: string | null
  connection_timeout_seconds?: number | null
  db_password_configured?: boolean | null
  remote_username?: string | null
  remote_password?: string | null
  known_hosts_policy?: string | null
  remote_file_protocol?: 'sftp' | 'sftp_compatible_scp' | 'scp' | string | null
  remote_private_key?: string | null
  remote_private_key_passphrase?: string | null
  known_hosts_text?: string | null
  auth_type?:
    | 'no_auth'
    | 'basic'
    | 'bearer'
    | 'api_key'
    | 'oauth2_client_credentials'
    | 'session_login'
    | 'jwt_refresh_token'
    | 'vendor_jwt_exchange'
  basic_username?: string | null
  basic_password?: string | null
  bearer_token?: string | null
  api_key_name?: string | null
  api_key_value?: string | null
  api_key_location?: 'headers' | 'query_params' | null
  oauth2_client_id?: string | null
  oauth2_client_secret?: string | null
  oauth2_token_url?: string | null
  oauth2_scope?: string | null
  login_url?: string | null
  login_path?: string | null
  login_method?: string | null
  login_headers?: Record<string, string>
  login_body_template?: Record<string, unknown>
  login_body_mode?: 'json' | 'form_urlencoded' | 'raw' | null
  login_body_raw?: string | null
  login_allow_redirects?: boolean | null
  session_cookie_name?: string | null
  login_username?: string | null
  login_password?: string | null
  preflight_enabled?: boolean | null
  preflight_method?: string | null
  preflight_path?: string | null
  preflight_url?: string | null
  preflight_headers?: Record<string, string>
  preflight_body_raw?: string | null
  preflight_follow_redirects?: boolean | null
  login_query_params?: Record<string, string>
  session_login_extractions?: Array<Record<string, unknown>>
  csrf_extract?: Record<string, unknown> | null
  refresh_token?: string | null
  token_url?: string | null
  token_path?: string | null
  token_http_method?: string | null
  refresh_token_header_name?: string | null
  refresh_token_header_prefix?: string | null
  access_token_json_path?: string | null
  access_token_header_name?: string | null
  access_token_header_prefix?: string | null
  token_ttl_seconds?: number | null
  user_id?: string | null
  api_key?: string | null
  token_method?: string | null
  token_auth_mode?: string | null
  token_content_type?: string | null
  token_body_mode?: string | null
  token_body?: string | null
  access_token_injection?: string | null
  access_token_query_name?: string | null
  token_custom_headers?: Record<string, string> | null
}

export async function fetchConnectorsList(): Promise<ConnectorRead[] | null> {
  return safeRequestJson<ConnectorRead[]>(`${GDC_API_PREFIX}/connectors/`, readJsonOpts)
}

export async function createConnector(payload: ConnectorWritePayload): Promise<ConnectorRead> {
  return requestJson<ConnectorRead>(`${GDC_API_PREFIX}/connectors/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchConnectorById(connectorId: number): Promise<ConnectorRead | null> {
  return safeRequestJson<ConnectorRead>(`${GDC_API_PREFIX}/connectors/${connectorId}`, readJsonOpts)
}

export async function updateConnector(connectorId: number, payload: ConnectorWritePayload): Promise<ConnectorRead> {
  return requestJson<ConnectorRead>(`${GDC_API_PREFIX}/connectors/${connectorId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteConnector(connectorId: number): Promise<void> {
  await requestJson<void>(`${GDC_API_PREFIX}/connectors/${connectorId}`, {
    method: 'DELETE',
  })
}
