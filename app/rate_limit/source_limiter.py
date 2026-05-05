"""Source-side rate limiting — protects upstream APIs (429, Retry-After)."""

# TODO: Token bucket / sliding window for HTTP polling (master design §15.1).


class SourceRateLimiter:
    """Throttle outbound API calls per stream/source configuration.

    Must remain separate from DestinationRateLimiter (project policy).
    """

    def allow(self, stream_id: int) -> bool:
        """TODO: return True if a fetch may proceed."""

        return True
