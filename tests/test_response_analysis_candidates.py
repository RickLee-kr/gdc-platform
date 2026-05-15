from __future__ import annotations

from app.runtime.response_analysis import build_http_api_test_analysis_dict


def test_event_array_candidates_regression_guard() -> None:
    parsed = {"hits": {"hits": [{"_source": {"srcip": "1.1.1.1"}}]}}
    analysis = build_http_api_test_analysis_dict(parsed, event_array_hint="$.hits.hits")
    paths = [item["path"] for item in analysis["detected_arrays"]]
    assert "$.hits.hits" in paths
    assert analysis["selected_event_array_default"] == "$.hits.hits"
