"""Bounded HTTP I/O and an explicit three-asset allowlist."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import socket
import sqlite3

from .store import Store, error

MAX_BODY = 8192
BODY_TIMEOUT = 3
ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError("nonfinite JSON")


class Handler(BaseHTTPRequestHandler):
    # No access log: URL/header content is untrusted and can contain tokens.
    def log_message(self, format, *args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(BODY_TIMEOUT)

    def send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, payload):
        self.send_bytes(status, json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"), "application/json; charset=utf-8")

    def token(self):
        headers = self.headers.get_all("Authorization", [])
        if len(headers) != 1 or not headers[0].startswith("Bearer "):
            return None
        token = headers[0][7:]
        if not token or len(token) > 128 or any(not (c.isascii() and (c.isalnum() or c in "_-")) for c in token):
            return None
        return token

    def do_GET(self):
        if self.path == "/api/state":
            self.send_json(*self.server.store.state(self.token()))
            return
        asset = ASSETS.get(self.path)
        if asset:
            try:
                data = (self.server.static_dir / asset[0]).read_bytes()
            except OSError:
                self.send_json(*error(404, "not_found", "找不到此頁面。"))
                return
            self.send_bytes(200, data, asset[1])
            return
        self.send_json(*error(404, "not_found", "找不到此頁面。"))

    def do_POST(self):
        if self.path not in ("/api/join", "/api/action"):
            self.send_json(*error(404, "not_found", "找不到此操作。"))
            return
        origins = self.headers.get_all("Origin", [])
        hosts = self.headers.get_all("Host", [])
        if origins and (len(origins) != 1 or len(hosts) != 1 or origins[0] != "http://" + hosts[0]):
            self.send_json(*error(400, "cross_origin", "請從本機遊戲頁面操作。"))
            return
        if self.headers.get_content_type() != "application/json":
            self.send_json(*error(415, "content_type", "操作必須使用 JSON 格式。"))
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
            self.send_json(*error(400, "invalid_length", "請提供有效的內容長度。"))
            return
        # Bound digit parsing too: enormous decimal strings are untrusted.
        if len(lengths[0]) > 8 or int(lengths[0]) > MAX_BODY:
            self.send_json(*error(413, "too_large", "操作資料超過 8192 位元組。"))
            return
        size = int(lengths[0])
        try:
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError("truncated body")
            body = json.loads(data.decode("utf-8"), parse_constant=invalid_constant, object_pairs_hook=object_pairs)
            if not isinstance(body, dict):
                raise ValueError("object required")
        except (ValueError, UnicodeError, RecursionError):
            self.send_json(*error(400, "invalid_json", "JSON 資料格式不正確。"))
            return
        except (socket.timeout, TimeoutError):
            self.send_json(*error(408, "request_timeout", "接收操作逾時，請重試同一操作。"))
            return
        try:
            result = self.server.store.join(body) if self.path == "/api/join" else self.server.store.action(self.token(), body)
        except sqlite3.Error:
            result = error(500, "storage_error", "保存暫時失敗，請重試同一操作。")
        self.send_json(*result)


class GameServer(HTTPServer):
    def server_close(self):
        super().server_close()
        if hasattr(self, "store"):
            self.store.close()


def make_server(host, port, db, static_dir=None):
    server = GameServer((host, port), Handler)
    try:
        server.store = Store(db)
        server.static_dir = Path(static_dir) if static_dir else Path(__file__).parent / "static"
    except Exception:
        server.server_close()
        raise
    return server
