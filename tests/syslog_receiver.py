"""Local Syslog TCP/UDP test receivers for E2E (in-process, high ports, no root)."""

from __future__ import annotations

import json
import socket
import threading
import time
from collections.abc import Callable
from typing import Any


def parse_compact_json_from_syslog_line(line: str) -> dict[str, Any] | None:
    """Extract the trailing compact JSON object from a syslog wire line (prefix + JSON)."""

    text = line.strip()
    if not text:
        return None
    idx = text.find("{")
    if idx < 0:
        return None
    try:
        return json.loads(text[idx:])
    except json.JSONDecodeError:
        return None


class SyslogUdpTestReceiver:
    """UDP syslog listener: captures datagram payloads as UTF-8 lines."""

    def __init__(self, *, host: str = "127.0.0.1", port: int = 0) -> None:
        self._host = host
        self._requested_port = int(port)
        self._sock: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._messages: list[str] = []

    @property
    def host(self) -> str:
        return self._host

    @property
    def port(self) -> int:
        if self._sock is None:
            raise RuntimeError("receiver not started")
        return int(self._sock.getsockname()[1])

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self._host, self._requested_port))
        sock.settimeout(0.35)
        self._sock = sock

        def _run() -> None:
            assert self._sock is not None
            while not self._stop.is_set():
                try:
                    data, _addr = self._sock.recvfrom(65535)
                except TimeoutError:
                    continue
                except OSError:
                    break
                try:
                    line = data.decode("utf-8", errors="replace")
                except Exception:
                    line = ""
                with self._lock:
                    self._messages.append(line)

        self._thread = threading.Thread(target=_run, name="syslog-udp-test-recv", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None

    def messages(self) -> list[str]:
        with self._lock:
            return list(self._messages)

    def clear(self) -> None:
        with self._lock:
            self._messages.clear()


class SyslogTcpTestReceiver:
    """TCP syslog listener: reads newline-delimited frames from each client session."""

    def __init__(self, *, host: str = "127.0.0.1", port: int = 0) -> None:
        self._host = host
        self._requested_port = int(port)
        self._server_sock: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._messages: list[str] = []

    @property
    def host(self) -> str:
        return self._host

    @property
    def port(self) -> int:
        if self._server_sock is None:
            raise RuntimeError("receiver not started")
        return int(self._server_sock.getsockname()[1])

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((self._host, self._requested_port))
        srv.listen(8)
        srv.settimeout(0.35)
        self._server_sock = srv

        def _handle_client(conn: socket.socket) -> None:
            buf = b""
            try:
                conn.settimeout(1.0)
                while True:
                    try:
                        chunk = conn.recv(65536)
                    except TimeoutError:
                        if self._stop.is_set():
                            break
                        continue
                    if not chunk:
                        break
                    buf += chunk
                    while b"\n" in buf:
                        raw_line, buf = buf.split(b"\n", 1)
                        line = raw_line.decode("utf-8", errors="replace")
                        with self._lock:
                            self._messages.append(line)
            finally:
                try:
                    conn.close()
                except OSError:
                    pass

        def _run() -> None:
            assert self._server_sock is not None
            while not self._stop.is_set():
                try:
                    client, _addr = self._server_sock.accept()
                except TimeoutError:
                    continue
                except OSError:
                    break
                _handle_client(client)

        self._thread = threading.Thread(target=_run, name="syslog-tcp-test-recv", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._server_sock is not None:
            try:
                self._server_sock.close()
            except OSError:
                pass
            self._server_sock = None
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None

    def messages(self) -> list[str]:
        with self._lock:
            return list(self._messages)

    def clear(self) -> None:
        with self._lock:
            self._messages.clear()


def wait_for_syslog_json(
    receiver: SyslogUdpTestReceiver | SyslogTcpTestReceiver,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout_seconds: float = 15.0,
    poll_interval_seconds: float = 0.05,
) -> dict[str, Any]:
    """Poll captured messages until ``predicate(parsed_json)`` is true or timeout."""

    deadline = time.monotonic() + float(timeout_seconds)
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        for line in receiver.messages():
            parsed = parse_compact_json_from_syslog_line(line)
            if not parsed:
                continue
            last = parsed
            if predicate(parsed):
                return parsed
        time.sleep(float(poll_interval_seconds))
    raise AssertionError(f"timeout waiting for syslog JSON (last parsed={last!r})")
