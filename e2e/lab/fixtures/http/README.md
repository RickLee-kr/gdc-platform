# Full E2E Lab HTTP auth fixtures
#
# Paths (WireMock base http://127.0.0.1:28080):
#   GET /no-auth/events
#   GET /basic/events          (user=e2e-basic-user pass=e2e-basic-pass)
#   GET /bearer/events         (Authorization: Bearer e2e-bearer-token)
#   GET /api-key-header/events (X-API-Key: e2e-api-key-value)
#
# Fault injection:
#   ?force_status=401|403 on /no-auth/events and /api-key-header/events
#   Missing/wrong credentials → 401 on basic/bearer/api-key
#
# Request journal: WireMock /__admin/requests (headers/query/body recorded)
