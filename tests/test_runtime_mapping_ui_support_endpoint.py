from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_json_paths_flat_object() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": {"a": 1, "b": "x"}, "max_depth": 8, "max_paths": 500},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    by_path = {item["path"]: item for item in body["paths"]}
    assert by_path["$.a"]["value_type"] == "number"
    assert by_path["$.a"]["sample_value"] == 1
    assert by_path["$.a"]["depth"] == 1
    assert by_path["$.a"]["is_array"] is False
    assert by_path["$.b"]["value_type"] == "string"


def test_json_paths_nested_object() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": {"outer": {"inner": {"leaf": True}}}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    item = body["paths"][0]
    assert item["path"] == "$.outer.inner.leaf"
    assert item["value_type"] == "boolean"
    assert item["sample_value"] is True
    assert item["depth"] == 3


def test_json_paths_array_uses_index_zero() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": {"items": [{"id": "first", "x": 99}, {"id": "ignored", "x": 0}]}},
    )
    assert response.status_code == 200
    body = response.json()
    paths = {row["path"]: row for row in body["paths"]}
    assert paths["$.items[0].id"]["sample_value"] == "first"
    assert paths["$.items[0].x"]["sample_value"] == 99
    assert paths["$.items[0].id"]["is_array"] is True
    assert not any(row["sample_value"] == "ignored" for row in body["paths"])


def test_json_paths_scalars_only_excludes_containers() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": {"empty_obj": {}, "arr": [1, 2, 3], "scalar": "ok"}},
    )
    assert response.status_code == 200
    body = response.json()
    paths_set = {row["path"] for row in body["paths"]}
    assert "$.empty_obj" not in paths_set
    assert "$.arr" not in paths_set
    assert "$.scalar" in paths_set
    assert "$.arr[0]" in paths_set


def test_json_paths_max_depth() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={
            "payload": {"a": 1, "b": {"c": 2, "d": {"e": 3}}},
            "max_depth": 2,
            "max_paths": 500,
        },
    )
    assert response.status_code == 200
    body = response.json()
    paths_set = {row["path"] for row in body["paths"]}
    assert "$.a" in paths_set
    assert "$.b.c" in paths_set
    assert "$.b.d.e" not in paths_set


def test_json_paths_max_paths_truncates_paths_but_total_full() -> None:
    payload_obj = {f"k{i}": i for i in range(10)}
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": payload_obj, "max_depth": 8, "max_paths": 3},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 10
    assert len(body["paths"]) == 3
    assert [row["path"] for row in body["paths"]] == ["$.k0", "$.k1", "$.k2"]


def test_json_paths_list_root_payload() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": [{"name": "n1"}, {"name": "n2"}]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["paths"][0]["path"] == "$[0].name"
    assert body["paths"][0]["sample_value"] == "n1"
    assert body["paths"][0]["is_array"] is True


def test_json_paths_invalid_payload_type_returns_422() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": "not-object-or-list"},
    )
    assert response.status_code == 422


def test_json_paths_does_not_use_db_commit_or_rollback(monkeypatch) -> None:
    called = {"commit": 0, "rollback": 0}

    def _raise_commit(*args, **kwargs):  # noqa: ANN002, ANN003
        called["commit"] += 1
        raise AssertionError("DB commit should not be called")

    def _raise_rollback(*args, **kwargs):  # noqa: ANN002, ANN003
        called["rollback"] += 1
        raise AssertionError("DB rollback should not be called")

    monkeypatch.setattr("sqlalchemy.orm.session.Session.commit", _raise_commit)
    monkeypatch.setattr("sqlalchemy.orm.session.Session.rollback", _raise_rollback)
    client = TestClient(app)
    response = client.post(
        "/api/v1/runtime/preview/json-paths",
        json={"payload": {"x": 1}},
    )
    assert response.status_code == 200
    assert called["commit"] == 0
    assert called["rollback"] == 0
