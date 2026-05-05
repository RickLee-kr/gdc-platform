"""Webhook ingest hook — future push-based source (master design §7.3, §6.2)."""

# TODO: Expose POST /ingest/webhook/{receiver_key} and feed StreamRunner pipeline.


class WebhookReceiver:
    """Placeholder for validating inbound webhooks and mapping to a stream."""

    def dispatch(self, receiver_key: str, payload: bytes) -> None:
        """TODO: authenticate, resolve stream, enqueue processing."""

        pass
