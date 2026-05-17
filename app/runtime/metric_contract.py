"""Metric ontology contract for runtime KPI semantics.

Equal ``metric_id`` values must mean equal aggregation semantics across APIs and UI.
Different concepts intentionally keep different IDs even when they share storage.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Mapping


class MetricSemanticType(StrEnum):
    CURRENT_RUNTIME_STATE = "current_runtime_state"
    SOURCE_INPUT_EVENTS = "source_input_events"
    DELIVERY_OUTCOME_EVENTS = "delivery_outcome_events"
    TELEMETRY_ROWS = "telemetry_rows"
    HISTORICAL_HEALTH = "historical_health"
    ROUTE_CONFIG_COUNT = "route_config_count"
    SYSTEM_RESOURCE = "system_resource"


@dataclass(frozen=True)
class MetricDefinition:
    metric_id: str
    label: str
    semantic_type: MetricSemanticType
    source_table: str
    source_tables: tuple[str, ...]
    source_stage_or_status: str
    aggregation_method: str
    aggregation_type: str
    window_policy: str
    includes_lifecycle_rows: bool
    includes_retry_success: bool
    includes_retry_failed: bool
    retry_policy: str
    lifecycle_policy: str
    disabled_route_policy: str
    idle_route_policy: str
    display_unit: str
    frontend_label: str
    frontend_description: str
    description: str

    def to_meta(
        self,
        *,
        window_start: datetime | None = None,
        window_end: datetime | None = None,
        generated_at: datetime | None = None,
    ) -> dict[str, Any]:
        data = asdict(self)
        data["semantic_type"] = self.semantic_type.value
        data["source_tables"] = list(self.source_tables)
        uses_snapshot_time_only = self.semantic_type in {
            MetricSemanticType.CURRENT_RUNTIME_STATE,
            MetricSemanticType.ROUTE_CONFIG_COUNT,
            MetricSemanticType.SYSTEM_RESOURCE,
        }
        if window_start is not None and not uses_snapshot_time_only:
            data["window_start"] = window_start.isoformat()
        if window_end is not None and not uses_snapshot_time_only:
            data["window_end"] = window_end.isoformat()
        snapshot_time = generated_at or window_end
        if snapshot_time is not None:
            data["generated_at"] = snapshot_time.isoformat()
        return data


def _m(
    metric_id: str,
    label: str,
    semantic_type: MetricSemanticType,
    source_table: str,
    source_stage_or_status: str,
    aggregation_method: str,
    window_policy: str,
    retry_policy: str,
    lifecycle_policy: str,
    disabled_route_policy: str,
    idle_route_policy: str,
    description: str,
    *,
    aggregation_type: str = "count",
    includes_lifecycle_rows: bool = False,
    includes_retry_success: bool = False,
    includes_retry_failed: bool = False,
    display_unit: str = "count",
    frontend_label: str | None = None,
    frontend_description: str | None = None,
) -> MetricDefinition:
    return MetricDefinition(
        metric_id=metric_id,
        label=label,
        semantic_type=semantic_type,
        source_table=source_table,
        source_tables=tuple(s.strip() for s in source_table.split("+")),
        source_stage_or_status=source_stage_or_status,
        aggregation_method=aggregation_method,
        aggregation_type=aggregation_type,
        window_policy=window_policy,
        includes_lifecycle_rows=includes_lifecycle_rows,
        includes_retry_success=includes_retry_success,
        includes_retry_failed=includes_retry_failed,
        retry_policy=retry_policy,
        lifecycle_policy=lifecycle_policy,
        disabled_route_policy=disabled_route_policy,
        idle_route_policy=idle_route_policy,
        display_unit=display_unit,
        frontend_label=frontend_label or label,
        frontend_description=frontend_description or description,
        description=description,
    )


_METRICS: dict[str, MetricDefinition] = {
    "current_runtime.healthy_streams": _m(
        "current_runtime.healthy_streams",
        "Healthy Streams (Live)",
        MetricSemanticType.CURRENT_RUNTIME_STATE,
        "streams + runtime health scoring",
        "current_runtime scoring mode",
        "Count streams currently scored HEALTHY in the live posture model.",
        "Recent posture slice derived from requested runtime window.",
        "Retry outcomes affect health scoring but are not counted directly here.",
        "Lifecycle rows are not counted directly.",
        "Route disabled state is not included in stream count.",
        "Idle running streams can be healthy when no scored failure evidence exists.",
        "Current runtime posture only.",
    ),
    "current_runtime.failed_routes": _m(
        "current_runtime.failed_routes",
        "Failed Routes (Live)",
        MetricSemanticType.CURRENT_RUNTIME_STATE,
        "routes + delivery_logs",
        "current_runtime route health levels UNHEALTHY and CRITICAL",
        "Count live route posture rows scored UNHEALTHY or CRITICAL.",
        "Recent posture slice derived from requested runtime window.",
        "Retry success can improve live posture; retry failure can degrade it.",
        "Lifecycle rows are excluded from route outcome scoring.",
        "Disabled routes are reported separately and are not live failures.",
        "Idle enabled routes are reported separately and are not live failures.",
        "Current runtime posture only.",
    ),
    "processed_events.window": _m(
        "processed_events.window",
        "Processed Events",
        MetricSemanticType.SOURCE_INPUT_EVENTS,
        "delivery_logs",
        "run_complete",
        "SUM(GREATEST(0, payload_sample.input_events))",
        "Bounded by API window_start/window_end, using created_at >= start and < end.",
        "Retries do not change processed source input events.",
        "Lifecycle rows other than run_complete are excluded.",
        "Disabled route state is irrelevant.",
        "Idle routes do not contribute.",
        "Source input events from run_complete.",
        aggregation_type="sum",
        display_unit="events",
        frontend_label="Processed Events",
        frontend_description="Source input events from committed run_complete rows.",
    ),
    "delivery_outcomes.window": _m(
        "delivery_outcomes.window",
        "Delivery Outcomes",
        MetricSemanticType.DELIVERY_OUTCOME_EVENTS,
        "delivery_logs",
        "route_send_success, route_retry_success, route_send_failed, route_retry_failed, route_unknown_failure_policy",
        "SUM(GREATEST(1, payload_sample.event_count)) across delivery outcome stages.",
        "Bounded by API window_start/window_end, using created_at >= start and < end.",
        "retry_success counts as success; retry_failed counts as failure.",
        "Lifecycle rows, run_complete, rate-limit rows, and route_skip are excluded.",
        "Disabled routes only contribute if committed delivery outcome rows exist.",
        "Idle routes do not contribute outcome events.",
        "Destination delivery outcome events.",
        aggregation_type="sum",
        includes_retry_success=True,
        includes_retry_failed=True,
        display_unit="events",
        frontend_label="Delivery Outcomes",
        frontend_description="Destination delivery outcome events from route success, failure, and retry stages.",
    ),
    "delivery_outcomes.success": _m(
        "delivery_outcomes.success",
        "Successful Delivery Outcomes",
        MetricSemanticType.DELIVERY_OUTCOME_EVENTS,
        "delivery_logs",
        "route_send_success, route_retry_success",
        "SUM(GREATEST(1, payload_sample.event_count)) on success outcome stages.",
        "Bounded by API window_start/window_end, using created_at >= start and < end.",
        "retry_success counts as success.",
        "Lifecycle rows are excluded.",
        "Disabled routes only contribute if committed success rows exist.",
        "Idle routes do not contribute.",
        "Successful destination delivery outcome events.",
        aggregation_type="sum",
        includes_retry_success=True,
        display_unit="events",
        frontend_label="Successful Delivery Outcomes",
        frontend_description="Successful destination delivery outcome events including retry successes.",
    ),
    "delivery_outcomes.failure": _m(
        "delivery_outcomes.failure",
        "Failed Delivery Outcomes",
        MetricSemanticType.DELIVERY_OUTCOME_EVENTS,
        "delivery_logs",
        "route_send_failed, route_retry_failed, route_unknown_failure_policy",
        "SUM(GREATEST(1, payload_sample.event_count)) on failure outcome stages.",
        "Bounded by API window_start/window_end, using created_at >= start and < end.",
        "retry_failed counts as failure; retry_success is excluded.",
        "Lifecycle rows are excluded.",
        "Disabled routes only contribute if committed failure rows exist.",
        "Idle routes do not contribute.",
        "Failed destination delivery outcome events.",
        aggregation_type="sum",
        includes_retry_failed=True,
        display_unit="events",
        frontend_label="Failed Delivery Outcomes",
        frontend_description="Failed destination delivery outcome events including retry failures.",
    ),
    "runtime_telemetry_rows.window": _m(
        "runtime_telemetry_rows.window",
        "Runtime Telemetry Rows",
        MetricSemanticType.TELEMETRY_ROWS,
        "delivery_logs",
        "all committed delivery_logs stages",
        "COUNT(delivery_logs.id)",
        "Bounded by API window_start/window_end, using created_at >= start and < end.",
        "Retry rows count as rows, not event_count units.",
        "Includes lifecycle rows such as run_complete; log rows, not source events.",
        "Disabled routes can have rows only if committed rows exist.",
        "Idle routes do not create rows.",
        "Committed delivery_logs telemetry rows including lifecycle stages.",
        aggregation_type="row_count",
        includes_lifecycle_rows=True,
        includes_retry_success=True,
        includes_retry_failed=True,
        display_unit="rows",
        frontend_label="Runtime Telemetry Rows",
        frontend_description="Committed delivery_logs telemetry rows including lifecycle stages.",
    ),
    "runtime_telemetry_rows.loaded": _m(
        "runtime_telemetry_rows.loaded",
        "Loaded Runtime Telemetry Rows",
        MetricSemanticType.TELEMETRY_ROWS,
        "delivery_logs",
        "rows returned by current logs query/page",
        "COUNT(rows loaded or matching current logs response)",
        "Bounded by logs query filters/page limit, not a global KPI window.",
        "Retry rows count as rows, not event_count units.",
        "Includes lifecycle rows present in the loaded result set.",
        "Disabled routes can appear if rows match the current query.",
        "Idle routes do not create rows.",
        "Committed delivery_logs telemetry rows in the current Logs load.",
        aggregation_type="loaded_row_count",
        includes_lifecycle_rows=True,
        includes_retry_success=True,
        includes_retry_failed=True,
        display_unit="rows",
        frontend_label="Loaded Runtime Telemetry Rows",
        frontend_description="Committed delivery_logs telemetry rows in the current Logs load.",
    ),
    "historical_health.routes": _m(
        "historical_health.routes",
        "Historical Route Health",
        MetricSemanticType.HISTORICAL_HEALTH,
        "delivery_logs",
        "historical_analytics route health scoring",
        "Health level counts from full-window delivery outcome aggregates.",
        "Full requested analytics window.",
        "Retry outcomes affect historical health scoring.",
        "Lifecycle rows are excluded from delivery outcome scoring.",
        "Disabled routes are reported separately.",
        "Idle routes are reported separately.",
        "Historical route health, not live failure.",
    ),
    "historical_health.streams": _m(
        "historical_health.streams",
        "Historical Stream Health",
        MetricSemanticType.HISTORICAL_HEALTH,
        "delivery_logs",
        "historical_analytics stream health scoring",
        "Health level counts from full-window delivery outcome aggregates.",
        "Full requested analytics window.",
        "Retry outcomes affect historical health scoring.",
        "Lifecycle rows are excluded from delivery outcome scoring.",
        "Route disabled state is not itself a stream failure.",
        "Idle streams are reported by health scoring where applicable.",
        "Historical stream health, not live runtime state.",
    ),
    "route_config.total": _m(
        "route_config.total",
        "Total Routes",
        MetricSemanticType.ROUTE_CONFIG_COUNT,
        "routes",
        "all configured routes",
        "COUNT(routes.id)",
        "Not windowed.",
        "Retry policy is irrelevant.",
        "Lifecycle rows are irrelevant.",
        "Includes enabled and disabled route records.",
        "Includes idle configured routes.",
        "Configured route count.",
    ),
    "route_config.enabled": _m(
        "route_config.enabled",
        "Enabled Routes",
        MetricSemanticType.ROUTE_CONFIG_COUNT,
        "routes + destinations",
        "route enabled and destination enabled or absent",
        "COUNT(routes.id) where route.enabled and destination is enabled or absent.",
        "Not windowed.",
        "Retry policy is irrelevant.",
        "Lifecycle rows are irrelevant.",
        "Excludes disabled routes and routes with disabled destinations.",
        "Includes idle enabled routes.",
        "Configured enabled route count.",
    ),
    "route_config.disabled": _m(
        "route_config.disabled",
        "Disabled Routes",
        MetricSemanticType.ROUTE_CONFIG_COUNT,
        "routes + destinations",
        "route disabled or destination disabled",
        "route_config.total - route_config.enabled",
        "Not windowed.",
        "Retry policy is irrelevant.",
        "Lifecycle rows are irrelevant.",
        "Explicitly counts disabled route posture.",
        "Idle policy is irrelevant.",
        "Configured disabled route count.",
    ),
    "runtime.throughput.processed_events_per_second": _m(
        "runtime.throughput.processed_events_per_second",
        "Processed Events Per Second",
        MetricSemanticType.SOURCE_INPUT_EVENTS,
        "delivery_logs",
        "run_complete",
        "processed_events.window / window_seconds",
        "Bounded by API window_start/window_end.",
        "Retries do not change processed source input events.",
        "Lifecycle rows other than run_complete are excluded.",
        "Disabled route state is irrelevant.",
        "Idle routes do not contribute.",
        "Processed source input events per second.",
    ),
    "routes.throughput.delivery_outcomes_per_second": _m(
        "routes.throughput.delivery_outcomes_per_second",
        "Delivery Outcomes Per Second",
        MetricSemanticType.DELIVERY_OUTCOME_EVENTS,
        "delivery_logs",
        "route delivery outcome stages",
        "delivery_outcomes.window / window_seconds",
        "Bounded by API window_start/window_end.",
        "Retry outcomes are included according to delivery_outcomes.window.",
        "Lifecycle rows are excluded.",
        "Disabled routes only contribute if committed outcome rows exist.",
        "Idle routes do not contribute.",
        "Destination delivery outcome events per second.",
    ),
}

METRIC_CONTRACT: Mapping[str, MetricDefinition] = MappingProxyType(_METRICS)


def get_metric(metric_id: str) -> MetricDefinition:
    return METRIC_CONTRACT[metric_id]


def get_metric_meta(
    metric_id: str,
    *,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    return get_metric(metric_id).to_meta(
        window_start=window_start,
        window_end=window_end,
        generated_at=generated_at,
    )


def metric_meta_map(
    *metric_ids: str,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    generated_at: datetime | None = None,
) -> dict[str, dict[str, Any]]:
    return {
        metric_id: get_metric_meta(
            metric_id,
            window_start=window_start,
            window_end=window_end,
            generated_at=generated_at,
        )
        for metric_id in metric_ids
    }
