"""Database query runner — future Oracle/MySQL/PostgreSQL collection."""

from app.runners.base import BaseRunner


class DBRunner(BaseRunner):
    """Placeholder for DATABASE_QUERY streams (master design §7.2, §6.3)."""

    def run(self, stream_id: int) -> None:
        """TODO: connect, run incremental query, emit rows as events."""

        pass
