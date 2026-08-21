"""Unit + StreamRunner integration tests for SourceRateLimiter."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.rate_limit.source_limiter import SourceRateLimiter
from app.runners.stream_loader import load_stream_context
from app.runners.stream_runner import StreamRunner
from app.streams.models import Stream
from tests.test_stream_runner_e2e import (
    _AllowAllLimiter,
    _FakePoller,
    _FakeWebhookSender,
    _FailIfCalledSyslogSender,
    _delivery_logs,
    _seed_stream_runtime,
)


class _FakeClock:
    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += float(seconds)


def test_allows_requests_under_limit() -> None:
    clock = _FakeClock()
    limiter = SourceRateLimiter(clock=clock)
    cfg = {"max_requests": 3, "per_seconds": 60}

    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is True


def test_blocks_when_limit_exceeded() -> None:
    clock = _FakeClock()
    limiter = SourceRateLimiter(clock=clock)
    cfg = {"max_requests": 2, "per_seconds": 60}

    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is False
    assert limiter.allow(1, cfg) is False


def test_refill_recovers_after_window() -> None:
    clock = _FakeClock()
    limiter = SourceRateLimiter(clock=clock)
    cfg = {"max_requests": 2, "per_seconds": 10}

    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is False

    # Half window → one token refilled (2 tokens / 10s = 0.2/s).
    clock.advance(5.0)
    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is False

    # Full window from empty → full capacity again.
    clock.advance(10.0)
    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is True
    assert limiter.allow(1, cfg) is False


def test_streams_are_isolated() -> None:
    clock = _FakeClock()
    limiter = SourceRateLimiter(clock=clock)
    cfg = {"max_requests": 1, "per_seconds": 60}

    assert limiter.allow(10, cfg) is True
    assert limiter.allow(10, cfg) is False
    assert limiter.allow(20, cfg) is True
    assert limiter.allow(20, cfg) is False


def test_empty_or_invalid_config_allows() -> None:
    clock = _FakeClock()
    limiter = SourceRateLimiter(clock=clock)

    assert limiter.allow(1, None) is True
    assert limiter.allow(1, {}) is True
    assert limiter.allow(1, {"max_requests": 0, "per_seconds": 60}) is True
    assert limiter.allow(1, {"max_requests": 5, "per_seconds": 0}) is True
    assert limiter.allow(1, {"max_requests": "x", "per_seconds": 60}) is True


def test_instance_state_does_not_contaminate_other_limiter() -> None:
    clock = _FakeClock()
    a = SourceRateLimiter(clock=clock)
    b = SourceRateLimiter(clock=clock)
    cfg = {"max_requests": 1, "per_seconds": 60}

    assert a.allow(1, cfg) is True
    assert a.allow(1, cfg) is False
    assert b.allow(1, cfg) is True


def test_load_stream_context_includes_source_rate_limit_json(db_session: Session) -> None:
    seeded = _seed_stream_runtime(db_session)
    context = load_stream_context(db_session, seeded["stream_id"])
    assert context.stream["rate_limit_json"] == {"max_requests": 10, "per_seconds": 60}


def test_http_poller_skipped_when_source_rate_limited(db_session: Session) -> None:
    """SourceRateLimiter throttle must skip fetch (normal throttling, not SourceFetchError)."""

    seeded = _seed_stream_runtime(db_session)
    # Seed uses max_requests=10; tighten so the second run is blocked.
    stream_row = db_session.query(Stream).filter(Stream.id == seeded["stream_id"]).one()
    stream_row.rate_limit_json = {"max_requests": 1, "per_seconds": 3600}
    db_session.commit()

    context = load_stream_context(db_session, seeded["stream_id"])
    poller = _FakePoller(response={"items": [{"id": "evt-1", "message": "m", "vendor": "V"}]})
    runner = StreamRunner(
        poller=poller,
        source_limiter=SourceRateLimiter(),
        destination_limiter=_AllowAllLimiter(),
        webhook_sender=_FakeWebhookSender(),
        syslog_sender=_FailIfCalledSyslogSender(),
    )

    summary1 = runner.run(context, db=db_session)
    assert summary1.get("outcome") == "completed"
    assert len(poller.calls) == 1

    context2 = load_stream_context(db_session, seeded["stream_id"])
    summary2 = runner.run(context2, db=db_session)
    assert len(poller.calls) == 1
    assert context2.stream["status"] == "RATE_LIMITED_SOURCE"
    stages = [row.stage for row in _delivery_logs(db_session, seeded["stream_id"])]
    assert "source_rate_limited" in stages
    assert summary2.get("transaction_committed") is True
