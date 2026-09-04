from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

MAX_BODY_BYTES = 4 * 1024 * 1024
count = 0
last_body = b""
lock = Lock()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        global count, last_body
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if length < 0 or length > MAX_BODY_BYTES:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        with lock:
            count += 1
            last_body = body
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/healthz":
            body = b"UP\n"
        elif self.path == "/count":
            with lock:
                body = f"{count}\n".encode()
        elif self.path == "/last":
            with lock:
                body = last_body
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


def main():
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()


if __name__ == "__main__":
    main()
