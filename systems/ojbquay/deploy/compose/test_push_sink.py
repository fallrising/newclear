import http.client
import importlib.util
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path


def load_sink_module():
    module_path = Path(__file__).with_name("push-sink.py")
    spec = importlib.util.spec_from_file_location("push_sink", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PushSinkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sink = load_sink_module()
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), cls.sink.Handler
        )
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, daemon=True
        )
        cls.thread.start()
        cls.base_url = (
            f"http://127.0.0.1:{cls.server.server_address[1]}"
        )

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self):
        with self.sink.lock:
            self.sink.count = 0
            self.sink.last_body = b""

    def test_exposes_count_and_last_payload(self):
        payload = b'{"event":"compose-e2e"}'
        request = urllib.request.Request(
            f"{self.base_url}/events",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )

        with urllib.request.urlopen(request) as response:
            self.assertEqual(204, response.status)

        with urllib.request.urlopen(
            f"{self.base_url}/count"
        ) as response:
            self.assertEqual(b"1\n", response.read())
        with urllib.request.urlopen(
            f"{self.base_url}/last"
        ) as response:
            self.assertEqual(payload, response.read())

    def test_rejects_payload_larger_than_product_limit(self):
        connection = http.client.HTTPConnection(
            *self.server.server_address, timeout=5
        )
        connection.putrequest("POST", "/events")
        connection.putheader("Content-Length", 4 * 1024 * 1024 + 1)
        connection.endheaders()
        response = connection.getresponse()

        self.assertEqual(413, response.status)
        response.read()
        connection.close()
        with urllib.request.urlopen(
            f"{self.base_url}/count"
        ) as response:
            self.assertEqual(b"0\n", response.read())


if __name__ == "__main__":
    unittest.main()
