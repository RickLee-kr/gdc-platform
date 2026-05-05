"""Destination-side rate limiting — EPS, batching, burst."""

# TODO: Throttle syslog/webhook sends per route/destination (master design §15.2).


class DestinationRateLimiter:
    """Throttle deliveries to syslog/webhook receivers.

    Must remain separate from SourceRateLimiter (project policy).
    """

    def allow(self, route_id: int) -> bool:
        """TODO: return True if an event may be sent on this route."""

        return True
