"""Loopback Jev-contract fixture. Unknown input is uncertain, never guessed safe."""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from fixtures import oracle


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send_json(self, status, obj):
        data = json.dumps(obj, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if self.path != "/v1/systemone" or self.headers.get("Authorization"):
            return self.send_json(403, {"error": "lab endpoint only; no credentials"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if not 0 < n <= 65536:
                return self.send_json(413, {"error": "size"})
            req = json.loads(self.rfile.read(n))
            rows, questions = req["state"]["rows"], req["questions"]
            # Fail if projection accidentally sends IDs, labels, tenant fields or secrets.
            if any(set(row) != {"text"} for row in rows):
                return self.send_json(422, {"error": "projection"})
            answers = {}
            for qid, q in questions.items():
                text = rows[int(qid[1:])]["text"]
                if text == "[http-error]":
                    return self.send_json(422, {"error": "synthetic upstream error"})
                if text == "[timeout]":
                    time.sleep(2)
                if text == "[missing-answer]":
                    continue
                value = oracle(text)
                if text == "[invalid-answer]":
                    value["risk"]["noul"] = 1.5
                if q["type"] == "noul":
                    answers[qid] = value["risk"]
                elif q["type"] == "choice" and set(q["criteria"]) == {"small", "coding", "reasoning"}:
                    answers[qid] = value["route"]
                else:
                    return self.send_json(422, {"error": "question"})
            self.send_json(200, {"model": "fixture-not-jev", "answers": answers,
                                 "usage": {"input_tokens": 0, "output_tokens": 0}})
        except (ValueError, KeyError, TypeError, IndexError):
            self.send_json(400, {"error": "contract"})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
