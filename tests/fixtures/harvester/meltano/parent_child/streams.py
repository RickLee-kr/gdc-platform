"""Parent/child Meltano RESTStream classes for static AST harvest."""


class RESTStream:
    pass


class OrgsStream(RESTStream):
    name = "orgs"
    path = "/v1/orgs"
    http_method = "GET"
    primary_keys = ["id"]
    records_jsonpath = "$.orgs[*]"


class OrgMembersStream(RESTStream):
    name = "org_members"
    path = "/v1/orgs/{org_id}/members"
    http_method = "GET"
    primary_keys = ["id"]
    records_jsonpath = "$.members[*]"
    parent_stream_type = OrgsStream
