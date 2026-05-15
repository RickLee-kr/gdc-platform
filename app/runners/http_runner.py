"""HTTP-specific runner slice — pairs with HTTP poller (no polling implementation yet)."""

from app.runners.base import BaseRunner


class HTTPRunner(BaseRunner):
    """HTTP API polling path inside StreamRunner."""

    def run(self, stream_id: int) -> None:
        """TODO: invoke HTTP poller, parsers, mappers, enrichers, delivery."""

        pass
