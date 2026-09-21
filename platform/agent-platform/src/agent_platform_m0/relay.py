"""Loopback TCP relay into a Docker internal network (which doesn't publish ports)."""

import select
import socket
import socketserver
import threading


class Relay:
    def __init__(self, target: tuple[str, int]):
        self.stopped = threading.Event()
        stopped = self.stopped

        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                try:
                    with socket.create_connection(target, timeout=2) as upstream:
                        self.request.settimeout(2)
                        while not stopped.is_set():
                            readable, _, _ = select.select([self.request, upstream], [], [], 0.2)
                            for source in readable:
                                data = source.recv(65536)
                                if not data:
                                    return
                                destination = upstream if source is self.request else self.request
                                destination.sendall(data)
                except OSError:
                    return  # Restart and readiness probes intentionally disconnect.

        self.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.stopped.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
