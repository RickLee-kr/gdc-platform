"""Stream-level mutex — prevent overlapping poll cycles."""

# TODO: Implement stream mutex (master design §17.3 — skip if already running).


class StreamLock:
    """Placeholder for asyncio.Lock or Redis lock backend."""

    def acquire(self, stream_id: int) -> bool:
        """TODO: try acquire lock for stream_id."""

        return False

    def release(self, stream_id: int) -> None:
        """TODO: release lock."""

        pass
