"""Log persistence — structured rows per engineering-standards stage fields."""

# TODO: Implement append-only structured logging to DeliveryLog (master design §18).


class LogService:
    """Placeholder for querying and writing delivery logs."""

    def list_logs(self) -> None:
        """TODO: paginated query over delivery_logs."""

        pass

    def append_log(self) -> None:
        """TODO: insert structured log row."""

        pass
