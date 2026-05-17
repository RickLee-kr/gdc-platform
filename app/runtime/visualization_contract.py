"""Visualization ontology contract for runtime chart semantics.

Chart metadata is intentionally separate from KPI metric metadata. A KPI and a
chart can share a source metric family while using different normalization.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Mapping

from app.runtime.metric_contract import METRIC_CONTRACT


class VisualizationType(StrEnum):
    LINE = "line"
    AREA = "area"
    BAR = "bar"
    HISTOGRAM = "histogram"
    DONUT = "donut"
    SPARKLINE = "sparkline"


class NormalizationRule(StrEnum):
    RAW_COUNT = "raw_count"
    EPS_BUCKET = "eps_bucket"
    EPS_WINDOW_AVG = "eps_window_avg"
    RATIO = "ratio"
    AVG_MS = "avg_ms"
    PERCENT = "percent"


@dataclass(frozen=True)
class BucketMeta:
    bucket_size_seconds: int
    bucket_count: int
    bucket_alignment: str = "window_floor_epoch"
    bucket_timezone: str = "UTC"
    bucket_mode: str = "fixed_window"

    def to_meta(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SubsetMeta:
    subset_of_metric_id: str
    subset_total: float
    global_total: float
    subset_coverage_ratio: float
    display_unit: str

    def to_meta(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class VisualizationDefinition:
    metric_id: str
    chart_metric_id: str
    aggregation_type: str
    visualization_type: VisualizationType
    normalization_rule: NormalizationRule
    bucket_unit: str
    bucket_size_seconds: int | None
    y_axis_semantics: str
    avg_vs_peak_semantics: str
    cumulative_semantics: str
    subset_semantics: str
    chart_window_semantics: str
    snapshot_alignment_required: bool
    display_unit: str
    tooltip_template: str

    def with_bucket_size(self, bucket_size_seconds: int | None) -> "VisualizationDefinition":
        if bucket_size_seconds is None:
            return self
        return replace(self, bucket_size_seconds=max(1, int(bucket_size_seconds)))

    def to_meta(
        self,
        *,
        bucket_size_seconds: int | None = None,
        bucket_count: int | None = None,
        snapshot_id: str | None = None,
        generated_at: datetime | None = None,
        window_start: datetime | None = None,
        window_end: datetime | None = None,
        subset: SubsetMeta | None = None,
    ) -> dict[str, Any]:
        definition = self.with_bucket_size(bucket_size_seconds)
        data = asdict(definition)
        data["visualization_type"] = definition.visualization_type.value
        data["normalization_rule"] = definition.normalization_rule.value
        if bucket_count is not None:
            data["bucket_count"] = int(bucket_count)
        if snapshot_id is not None:
            data["snapshot_id"] = snapshot_id
        if generated_at is not None:
            data["generated_at"] = generated_at.isoformat()
        if window_start is not None:
            data["window_start"] = window_start.isoformat()
        if window_end is not None:
            data["window_end"] = window_end.isoformat()
        if subset is not None:
            data["subset"] = subset.to_meta()
            data["subset_semantics"] = (
                f"Subset of {subset.subset_of_metric_id}; coverage ratio is "
                "subset_total / global_total when global_total is positive."
            )
        return data


def _v(
    metric_id: str,
    chart_metric_id: str,
    aggregation_type: str,
    visualization_type: VisualizationType,
    normalization_rule: NormalizationRule,
    bucket_unit: str,
    y_axis_semantics: str,
    avg_vs_peak_semantics: str,
    cumulative_semantics: str,
    subset_semantics: str,
    chart_window_semantics: str,
    display_unit: str,
    tooltip_template: str,
    *,
    bucket_size_seconds: int | None = None,
    snapshot_alignment_required: bool = True,
) -> VisualizationDefinition:
    if metric_id not in METRIC_CONTRACT:
        raise KeyError(f"unknown metric_id for visualization contract: {metric_id}")
    return VisualizationDefinition(
        metric_id=metric_id,
        chart_metric_id=chart_metric_id,
        aggregation_type=aggregation_type,
        visualization_type=visualization_type,
        normalization_rule=normalization_rule,
        bucket_unit=bucket_unit,
        bucket_size_seconds=bucket_size_seconds,
        y_axis_semantics=y_axis_semantics,
        avg_vs_peak_semantics=avg_vs_peak_semantics,
        cumulative_semantics=cumulative_semantics,
        subset_semantics=subset_semantics,
        chart_window_semantics=chart_window_semantics,
        snapshot_alignment_required=snapshot_alignment_required,
        display_unit=display_unit,
        tooltip_template=tooltip_template,
    )


_VISUALIZATIONS: dict[str, VisualizationDefinition] = {
    "runtime.throughput.window_avg_eps": _v(
        "runtime.throughput.processed_events_per_second",
        "runtime.throughput.window_avg_eps",
        "sum_over_window_divided_by_window_seconds",
        VisualizationType.SPARKLINE,
        NormalizationRule.EPS_WINDOW_AVG,
        "window",
        "Processed source input events per second averaged over the full resolved window.",
        "Window average can be lower than a peak bucket when events cluster in time.",
        "not_cumulative",
        "global_metric",
        "Uses the response window_start/window_end and metrics_window_seconds.",
        "evt/s",
        "{metric_family}: {value} {unit}; window avg; snapshot {snapshot_time}.",
    ),
    "runtime.throughput.bucket_eps": _v(
        "processed_events.window",
        "runtime.throughput.bucket_eps",
        "bucket_sum_divided_by_bucket_seconds",
        VisualizationType.LINE,
        NormalizationRule.EPS_BUCKET,
        "second",
        "Processed source input events per second within each fixed bucket.",
        "Peak bucket is the max bucket EPS; it is not the full-window average.",
        "not_cumulative",
        "global_metric",
        "Buckets are dense fixed windows within response window_start/window_end.",
        "evt/s",
        "{metric_family}: {value} {unit}; bucket {bucket_seconds}s; snapshot {snapshot_time}.",
    ),
    "routes.throughput.window_avg_eps": _v(
        "routes.throughput.delivery_outcomes_per_second",
        "routes.throughput.window_avg_eps",
        "sum_over_window_divided_by_window_seconds",
        VisualizationType.SPARKLINE,
        NormalizationRule.EPS_WINDOW_AVG,
        "window",
        "Destination delivery outcome events per second averaged over the full resolved window.",
        "Route KPI window average can differ from route throughput chart bucket peaks.",
        "not_cumulative",
        "route_or_global_metric",
        "Uses the response window_start/window_end and metrics_window_seconds.",
        "EPS",
        "{metric_family}: {value} {unit}; window avg; snapshot {snapshot_time}.",
    ),
    "routes.throughput.bucket_eps": _v(
        "delivery_outcomes.window",
        "routes.throughput.bucket_eps",
        "bucket_delivery_outcome_sum_divided_by_bucket_seconds",
        VisualizationType.AREA,
        NormalizationRule.EPS_BUCKET,
        "second",
        "Destination delivery outcome events per second within each fixed bucket.",
        "Peak bucket is the max bucket EPS; KPI is full-window average EPS.",
        "not_cumulative",
        "route_or_global_metric",
        "Buckets are dense fixed windows within response window_start/window_end.",
        "EPS",
        "{metric_family}: {value} {unit}; delivery bucket {bucket_seconds}s; snapshot {snapshot_time}.",
    ),
    "dashboard.delivery_outcomes.bucket_count": _v(
        "delivery_outcomes.window",
        "dashboard.delivery_outcomes.bucket_count",
        "bucket_delivery_outcome_event_sum",
        VisualizationType.BAR,
        NormalizationRule.RAW_COUNT,
        "bucket",
        "Delivery outcome event counts per fixed bucket.",
        "Raw bucket counts are not EPS and should not be compared to throughput KPIs without normalization.",
        "not_cumulative",
        "global_metric",
        "Dense fixed buckets within dashboard snapshot window.",
        "events",
        "{metric_family}: {value} {unit}; raw bucket count; snapshot {snapshot_time}.",
    ),
    "stream.processed_events.bucket_count": _v(
        "processed_events.window",
        "stream.processed_events.bucket_count",
        "bucket_processed_event_sum",
        VisualizationType.BAR,
        NormalizationRule.RAW_COUNT,
        "bucket",
        "Processed source input event counts per fixed bucket.",
        "Raw bucket counts are not EPS and can differ from window-average throughput.",
        "not_cumulative",
        "stream_metric",
        "Dense fixed buckets within stream response window_start/window_end.",
        "events",
        "{metric_family}: {value} events; processed bucket count; snapshot {snapshot_time}.",
    ),
    "stream.delivery_outcomes.bucket_count": _v(
        "delivery_outcomes.window",
        "stream.delivery_outcomes.bucket_count",
        "bucket_delivery_outcome_event_sum",
        VisualizationType.BAR,
        NormalizationRule.RAW_COUNT,
        "bucket",
        "Delivered and failed destination delivery outcome event counts per fixed bucket.",
        "Raw bucket counts are not EPS and should not be compared to throughput KPIs without normalization.",
        "not_cumulative",
        "stream_metric",
        "Dense fixed buckets within stream response window_start/window_end.",
        "events",
        "{metric_family}: {value} events; delivery outcome bucket count; snapshot {snapshot_time}.",
    ),
    "analytics.delivery_failures.bucket_histogram": _v(
        "delivery_outcomes.failure",
        "analytics.delivery_failures.bucket_histogram",
        "bucket_failure_event_sum",
        VisualizationType.HISTOGRAM,
        NormalizationRule.RAW_COUNT,
        "bucket",
        "Failed delivery outcome event counts per fixed bucket.",
        "Histogram bucket counts are independent values, not a running total.",
        "histogram_not_cumulative",
        "filtered_metric",
        "Fixed buckets over the resolved analytics window and filters.",
        "failures",
        "{metric_family}: {value} failures; histogram bucket; snapshot {snapshot_time}.",
    ),
    "runtime_telemetry.rows.bucket_count": _v(
        "runtime_telemetry_rows.window",
        "runtime_telemetry.rows.bucket_count",
        "bucket_row_count",
        VisualizationType.HISTOGRAM,
        NormalizationRule.RAW_COUNT,
        "bucket",
        "Committed delivery_logs row counts per fixed bucket.",
        "Telemetry row counts are not source input events and are not EPS.",
        "histogram_not_cumulative",
        "filtered_or_loaded_metric",
        "Fixed buckets or loaded logs query scope, depending on endpoint.",
        "rows",
        "{metric_family}: {value} rows; raw bucket count; snapshot {snapshot_time}.",
    ),
    "runtime.top_streams.throughput_share.window_avg_eps": _v(
        "runtime.throughput.processed_events_per_second",
        "runtime.top_streams.throughput_share.window_avg_eps",
        "top_n_window_avg_eps_divided_by_global_window_avg_eps",
        VisualizationType.DONUT,
        NormalizationRule.EPS_WINDOW_AVG,
        "window",
        "Top stream processed event EPS share over the full resolved window.",
        "Top-N total is a subset of global throughput, not a reconciliation error.",
        "not_cumulative",
        "subset_of_global_metric",
        "Uses the same snapshot window as the global runtime throughput KPI.",
        "evt/s",
        "{metric_family}: {value} {unit}; subset coverage {coverage}; snapshot {snapshot_time}.",
    ),
    "routes.destination_delivery_outcomes.donut_count": _v(
        "delivery_outcomes.window",
        "routes.destination_delivery_outcomes.donut_count",
        "destination_delivery_outcome_event_sum",
        VisualizationType.DONUT,
        NormalizationRule.RAW_COUNT,
        "window",
        "Destination delivery outcome event share over the resolved window.",
        "Donut counts are window totals, not bucket peaks or EPS.",
        "not_cumulative",
        "grouped_by_destination",
        "Uses the response analytics or route window.",
        "events",
        "{metric_family}: {value} events; grouped by destination; snapshot {snapshot_time}.",
    ),
    "routes.success_rate.bucket_ratio": _v(
        "delivery_outcomes.window",
        "routes.success_rate.bucket_ratio",
        "bucket_success_events_divided_by_bucket_delivery_outcomes",
        VisualizationType.AREA,
        NormalizationRule.PERCENT,
        "bucket",
        "Successful delivery outcome events divided by all delivery outcome events per bucket.",
        "Bucket percentages can differ from full-window success rate.",
        "not_cumulative",
        "route_or_global_metric",
        "Dense fixed buckets within response window_start/window_end.",
        "%",
        "{metric_family}: {value}%; bucket success ratio; snapshot {snapshot_time}.",
    ),
    "routes.latency.bucket_avg_ms": _v(
        "delivery_outcomes.success",
        "routes.latency.bucket_avg_ms",
        "bucket_avg_latency_ms",
        VisualizationType.LINE,
        NormalizationRule.AVG_MS,
        "bucket",
        "Average successful delivery latency in milliseconds per fixed bucket.",
        "Bucket average latency can differ from full-window average or p95 latency.",
        "not_cumulative",
        "route_or_stream_metric",
        "Dense fixed buckets within response window_start/window_end.",
        "ms",
        "{metric_family}: {value} ms; bucket average latency; snapshot {snapshot_time}.",
    ),
}

VISUALIZATION_CONTRACT: Mapping[str, VisualizationDefinition] = MappingProxyType(_VISUALIZATIONS)


def get_visualization(chart_metric_id: str) -> VisualizationDefinition:
    return VISUALIZATION_CONTRACT[chart_metric_id]


def get_visualization_meta(
    chart_metric_id: str,
    *,
    bucket_size_seconds: int | None = None,
    bucket_count: int | None = None,
    snapshot_id: str | None = None,
    generated_at: datetime | None = None,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    subset: SubsetMeta | None = None,
) -> dict[str, Any]:
    return get_visualization(chart_metric_id).to_meta(
        bucket_size_seconds=bucket_size_seconds,
        bucket_count=bucket_count,
        snapshot_id=snapshot_id,
        generated_at=generated_at,
        window_start=window_start,
        window_end=window_end,
        subset=subset,
    )


def visualization_meta_map(
    *chart_metric_ids: str,
    bucket_size_seconds: int | None = None,
    bucket_count: int | None = None,
    snapshot_id: str | None = None,
    generated_at: datetime | None = None,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    subsets: Mapping[str, SubsetMeta] | None = None,
) -> dict[str, dict[str, Any]]:
    return {
        chart_metric_id: get_visualization_meta(
            chart_metric_id,
            bucket_size_seconds=bucket_size_seconds,
            bucket_count=bucket_count,
            snapshot_id=snapshot_id,
            generated_at=generated_at,
            window_start=window_start,
            window_end=window_end,
            subset=(subsets or {}).get(chart_metric_id),
        )
        for chart_metric_id in chart_metric_ids
    }


def bucket_meta(bucket_size_seconds: int, bucket_count: int) -> dict[str, Any]:
    return BucketMeta(
        bucket_size_seconds=max(1, int(bucket_size_seconds)),
        bucket_count=max(0, int(bucket_count)),
    ).to_meta()

