"""RFC3164/RFC5424-style syslog message builder — MVP framing."""

# TODO: Build syslog prefix + payload per destination options (master design §11).


class SyslogFormatter:
    """Placeholder for syslog message assembly."""

    def format(self, event: dict[str, object]) -> bytes:
        """TODO: return encoded syslog datagram payload."""

        return b""
