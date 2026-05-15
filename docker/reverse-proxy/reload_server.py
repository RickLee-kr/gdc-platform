#!/usr/bin/env python3
"""Internal-only nginx reload hook (Bearer token). Listens on port 8099 inside the proxy container."""

from __future__ import annotations

import http.server
import json
import os
import subprocess


TOKEN = (os.environ.get("GDC_PROXY_RELOAD_TOKEN") or "").strip()


class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:  # noqa: ANN001
        return

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/__gdc_internal/reload":
            self.send_error(404)
            return
        if not TOKEN:
            self.send_response(503)
            self.end_headers()
            return
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {TOKEN}":
            self.send_response(401)
            self.end_headers()
            return
        cl = int(self.headers.get("Content-Length", "0") or "0")
        _ = self.rfile.read(cl) if cl else b"{}"
        test = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
        if test.returncode != 0:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"ok": False, "stage": "nginx -t", "stderr": test.stderr}).encode("utf-8"),
            )
            return
        subprocess.run(["nginx", "-s", "reload"], check=False)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))


def main() -> None:
    http.server.HTTPServer(("0.0.0.0", 8099), _Handler).serve_forever()


if __name__ == "__main__":
    main()
