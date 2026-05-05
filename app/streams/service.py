"""Stream use-cases — CRUD and start/stop deferred."""

# TODO: Implement CRUD and runtime hooks (master design §19.3, development-rules Stream start/stop).


class StreamService:
    """Placeholder for stream management and control."""

    def list_streams(self) -> None:
        pass

    def get_stream(self, stream_id: int) -> None:
        pass

    def create_stream(self) -> None:
        pass

    def update_stream(self, stream_id: int) -> None:
        pass

    def delete_stream(self, stream_id: int) -> None:
        pass

    def start_stream(self, stream_id: int) -> None:
        """TODO: register stream with scheduler / runner."""

        pass

    def stop_stream(self, stream_id: int) -> None:
        """TODO: stop stream execution."""

        pass
