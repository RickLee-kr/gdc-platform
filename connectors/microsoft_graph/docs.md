# Microsoft Graph Security Connector Module

Declarative connector module for Microsoft Graph security and identity APIs.

## Setup

1. Register an Azure AD application with appropriate Graph API permissions.
2. Set Graph API Base URL to `https://graph.microsoft.com`.
3. Provide OAuth2 client credentials (client ID, secret, token URL, scope).
4. Select **Security Alerts** and/or **Sign-in Logs** stream templates.
5. Validate mapping with API Test before enabling streams.

## Streams

| Stream | Endpoint | Description |
|--------|----------|-------------|
| security_alerts | `/v1.0/security/alerts` | Microsoft 365 Defender alerts |
| sign_ins | `/v1.0/auditLogs/signIns` | Azure AD sign-in audit logs |

## Documentation

- [Microsoft Graph API overview](https://learn.microsoft.com/en-us/graph/api/overview)
