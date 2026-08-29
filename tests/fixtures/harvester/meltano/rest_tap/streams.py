"""Synthetic Meltano RESTStream classes for static AST harvest (not executable)."""


class RESTStream:
    """Stand-in for singer_sdk.streams.RESTStream (not imported)."""


class UsersStream:
    """Intentionally not a RESTStream — ignored."""

    name = "ignored"


class UsersRESTStream(RESTStream):
    name = "users"
    path = "/v1/users"
    http_method = "GET"
    primary_keys = ["id"]
    replication_key = "updated_at"
    records_jsonpath = "$.data[*]"
    next_page_token_jsonpath = "$.next"


class GroupsStream(RESTStream):
    name = "groups"
    path = "/v1/groups"
    http_method = "GET"
    records_jsonpath = "$[*]"
