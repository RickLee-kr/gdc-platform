"""Canonical observability metric contract for runtime operations surfaces.

This module is the shared metric ontology for Dashboard, Runtime, Routes,
Analytics, and Logs. Equal metric keys here must mean equal aggregation,
window, snapshot, and display semantics everywhere they are consumed.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from types import MappingProxyType
from typing import Any, Mapping

METRIC_CONTRACT_VERSION = "v1"

DELIVERY_SUCCESS_STAGES = frozenset({"route_send_success"})
DELIVERY_FAILED_STAGES = frozenset({"route_send_failed", "route_unknown_failure_policy"})
RETRY_SUCCESS_STAGES = frozenset({"route_retry_success"})
RETRY_FAILED_STAGES = frozenset({"route_retry_failed"})
RETRY_OUTCOME_STAGES = RETRY_SUCCESS_STAGES | RETRY_FAILED_STAGES
DELIVERY_OUTCOME_STAGES = (
    DELIVERY_SUCCESS_STAGES
    | DELIVERY_FAILED_STAGES
    | RETRY_SUCCESS_STAGES
    | RETRY_FAILED_STAGES
)
RATE_LIMIT_STAGES = frozenset({"source_rate_limited", "destination_rate_limited"})
RUN_COMPLETE_STAGES = frozenset({"run_complete"})

KNOWN_OPERATIONAL_STAGES = DELIVERY_OUTCOME_STAGES | RATE_LIMIT_STAGES
KNOWN_LIFECYCLE_STAGES = frozenset(
    {
        "run_started",
        "run_complete",
        "checkpoint_update",
        "fanout_start",
        "fanout_complete",
        "mapping_applied",
        "enrichment_applied",
        "formatting_applied",
        "route_skip",
    }
)


@dataclass(frozen=True)
class ObservabilityMetricDefinition:
    metric_key: str
    semantic_meaning: str
    included_delivery_log_stages: tuple[str, ...]
    excluded_delivery_log_stages: tuple[str, ...]
    aggregation_rule: str
    window_rule: str
    snapshot_consistency_rule: str
    display_semantics: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["included_delivery_log_stages"] = list(self.included_delivery_log_stages)
        data["excluded_delivery_log_stages"] = list(self.excluded_delivery_log_stages)
        return data


def _d(
    metric_key: str,
    semantic_meaning: str,
    *,
    includes: frozenset[str] | tuple[str, ...],
    excludes: frozenset[str] | tuple[str, ...],
    aggregation_rule: str,
    display_semantics: str,
) -> ObservabilityMetricDefinition:
    return ObservabilityMetricDefinition(
        metric_key=metric_key,
        semantic_meaning=semantic_meaning,
        included_delivery_log_stages=tuple(sorted(includes)),
        excluded_delivery_log_stages=tuple(sorted(excludes)),
        aggregation_rule=aggregation_rule,
        window_rule="Use the resolved [window_start, window_end) selected by the canonical summary snapshot.",
        snapshot_consistency_rule="For shared metrics, consumers must use the same snapshot_id, generated_at, window_start, and window_end.",
        display_semantics=display_semantics,
    )


_ALL = ("all committed delivery_logs stages",)
_NON_OUTCOME = tuple(sorted(KNOWN_LIFECYCLE_STAGES | RATE_LIMIT_STAGES))

OBSERVABILITY_METRIC_CONTRACT: Mapping[str, ObservabilityMetricDefinition] = MappingProxyType(
    {
        "runtime_telemetry_rows": _d(
            "runtime_telemetry_rows",
            "Total committed delivery_logs rows in the selected window.",
            includes=_ALL,
            excludes=(),
            aggregation_rule="COUNT(delivery_logs.id).",
            display_semantics="Global telemetry row count; never label a loaded page/sample count as this metric.",
        ),
        "lifecycle_rows": _d(
            "lifecycle_rows",
            "Non-operational lifecycle telemetry rows in the selected window.",
            includes=KNOWN_LIFECYCLE_STAGES,
            excludes=KNOWN_OPERATIONAL_STAGES,
            aggregation_rule="COUNT rows classified as lifecycle, plus non-WARN/ERROR rows outside delivery/retry/rate-limit outcomes.",
            display_semantics="Lifecycle telemetry is useful audit context but secondary to operational outcomes.",
        ),
        "delivery_success_events": _d(
            "delivery_success_events",
            "Successful first-attempt destination delivery outcomes only.",
            includes=DELIVERY_SUCCESS_STAGES,
            excludes=RETRY_OUTCOME_STAGES | DELIVERY_FAILED_STAGES | KNOWN_LIFECYCLE_STAGES,
            aggregation_rule="SUM(GREATEST(1, payload_sample.event_count)) over route_send_success.",
            display_semantics="Destination delivery successes; retry successes are shown separately.",
        ),
        "delivery_failed_events": _d(
            "delivery_failed_events",
            "Failed first-attempt destination delivery outcomes only.",
            includes=DELIVERY_FAILED_STAGES,
            excludes=RETRY_OUTCOME_STAGES | DELIVERY_SUCCESS_STAGES | KNOWN_LIFECYCLE_STAGES,
            aggregation_rule="SUM(GREATEST(1, payload_sample.event_count)) over failed delivery stages.",
            display_semantics="Destination delivery failures; retry failures are shown separately.",
        ),
        "retry_success_events": _d(
            "retry_success_events",
            "Successful retry delivery outcomes.",
            includes=RETRY_SUCCESS_STAGES,
            excludes=DELIVERY_SUCCESS_STAGES | DELIVERY_FAILED_STAGES | KNOWN_LIFECYCLE_STAGES,
            aggregation_rule="SUM(GREATEST(1, payload_sample.event_count)) over route_retry_success.",
            display_semantics="Retry successes are operational outcomes but not first-attempt delivery successes.",
        ),
        "retry_failed_events": _d(
            "retry_failed_events",
            "Failed retry delivery outcomes.",
            includes=RETRY_FAILED_STAGES,
            excludes=DELIVERY_SUCCESS_STAGES | DELIVERY_FAILED_STAGES | KNOWN_LIFECYCLE_STAGES,
            aggregation_rule="SUM(GREATEST(1, payload_sample.event_count)) over route_retry_failed.",
            display_semantics="Retry failures are operational degradation signals.",
        ),
        "processed_events": _d(
            "processed_events",
            "Source-side processed event count derived from run_complete semantics.",
            includes=RUN_COMPLETE_STAGES,
            excludes=DELIVERY_OUTCOME_STAGES,
            aggregation_rule="SUM(GREATEST(0, payload_sample.input_events)) over run_complete.",
            display_semantics="Source processed events; not a destination delivery count.",
        ),
        "healthy_routes": _d(
            "healthy_routes",
            "Enabled routes with successful delivery activity in the selected window and no degradation threshold breach.",
            includes=DELIVERY_SUCCESS_STAGES | RETRY_SUCCESS_STAGES,
            excludes=(),
            aggregation_rule="Route classification using canonical route health scoring for the same snapshot/window.",
            display_semantics="Healthy is successful activity. Idle routes are not counted as healthy.",
        ),
        "idle_routes": _d(
            "idle_routes",
            "Enabled routes with zero delivery outcomes in the selected window.",
            includes=(),
            excludes=DELIVERY_OUTCOME_STAGES,
            aggregation_rule="Enabled configured routes minus enabled routes with delivery outcome activity.",
            display_semantics="Idle is neutral inactivity, not failure.",
        ),
        "unhealthy_routes": _d(
            "unhealthy_routes",
            "Routes with delivery failures or retries crossing degradation thresholds.",
            includes=DELIVERY_FAILED_STAGES | RETRY_FAILED_STAGES,
            excludes=KNOWN_LIFECYCLE_STAGES,
            aggregation_rule="Route classification using canonical route health scoring for the same snapshot/window.",
            display_semantics="Unhealthy and critical are operational failure states; idle is separate.",
        ),
        "throughput_eps": _d(
            "throughput_eps",
            "Delivery outcome throughput normalized by bucket/window seconds.",
            includes=DELIVERY_OUTCOME_STAGES,
            excludes=KNOWN_LIFECYCLE_STAGES,
            aggregation_rule="(delivery + retry outcome events) / effective bucket or window seconds.",
            display_semantics="Never round non-zero throughput to 0.00.",
        ),
        "p95_latency_ms": _d(
            "p95_latency_ms",
            "P95 delivery latency from committed delivery metrics only.",
            includes=DELIVERY_OUTCOME_STAGES,
            excludes=KNOWN_LIFECYCLE_STAGES | RATE_LIMIT_STAGES,
            aggregation_rule="percentile_disc(0.95) over latency_ms for delivery outcome rows with latency.",
            display_semantics="Show milliseconds; null means no committed delivery latency samples.",
        ),
    }
)


def observability_metric_contract_payload() -> dict[str, Any]:
    return {
        "metric_contract_version": METRIC_CONTRACT_VERSION,
        "metrics": {key: value.to_dict() for key, value in OBSERVABILITY_METRIC_CONTRACT.items()},
    }

