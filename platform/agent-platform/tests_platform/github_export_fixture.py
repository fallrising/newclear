"""Loopback-only GitHub HTTP fixture; accepts an explicit synthetic token only."""

import base64
import copy
import hashlib
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LoopbackOpener:
    """Rewrite the fixed API origin for tests, never for a production credential."""

    def __init__(self, url, token="synthetic-export-token"):
        parsed = urlsplit(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or not parsed.port
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or not token.startswith("synthetic-")
        ):
            raise ValueError("fixture_configuration_invalid")
        self.url, self.token = url, token
        self.transport = build_opener(ProxyHandler({}), NoRedirect())

    def open(self, request, timeout):
        parsed = urlsplit(request.full_url)
        if (
            parsed.scheme != "https"
            or parsed.netloc != "api.github.com"
            or request.get_header("Authorization") != "Bearer " + self.token
        ):
            raise ValueError("fixture_request_invalid")
        path = parsed.path + ("?" + parsed.query if parsed.query else "")
        local = Request(
            self.url + path,
            data=request.data,
            headers=dict(request.header_items()),
            method=request.method,
        )
        return self.transport.open(local, timeout=timeout)


def _sha(kind, data):
    return hashlib.sha1(kind.encode() + b" " + str(len(data)).encode() + b"\0" + data).hexdigest()


class FakeGitHub:
    repo = "example/repo"
    base_branch = "main"

    def __init__(self, files=None, *, token="synthetic-export-token"):
        if not token.startswith("synthetic-"):
            raise ValueError("fixture_configuration_invalid")
        self.token = token
        self.files = dict(files or {})
        self.requests, self.faults, self.pulls = [], [], []
        self.refs, self.commits, self.trees, self.blobs = {}, {}, {}, {}
        self.lock = threading.RLock()
        self.server = self.thread = None
        entries = []
        for path, raw in self.files.items():
            data = raw.encode() if isinstance(raw, str) else raw
            sha = _sha("blob", data)
            self.blobs[sha] = data
            entries.append(
                {"path": path, "mode": "100644", "type": "blob", "sha": sha, "size": len(data)}
            )
        self.base_tree = self._tree(entries)
        base = self._commit({"tree": self.base_tree, "parents": [], "message": "fixture base"})
        self.base_sha = base["sha"]
        self.refs[self.base_branch] = self.base_sha

    def __enter__(self):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def do_GET(self):
                self.dispatch()

            def do_POST(self):
                self.dispatch()

            def dispatch(self):
                if self.headers.get("Authorization") != "Bearer " + fixture.token:
                    self.reply(401, {"message": "fixture token required"})
                    return
                try:
                    size = int(self.headers.get("Content-Length", 0))
                    if not 0 <= size <= 8 * 1024 * 1024:
                        raise ValueError()
                    body = self.rfile.read(size)
                    payload = json.loads(body) if body else None
                    with fixture.lock:
                        fixture.requests.append(
                            {"method": self.command, "path": self.path, "payload": payload}
                        )
                        fault = fixture._fault(self.command, self.path)
                        if fault and not fault["after"]:
                            status, response = 200, {}
                        else:
                            status, response = fixture._route(self.command, self.path, payload)
                        if fault:
                            if fault["disconnect"]:
                                self.close_connection = True
                                self.connection.shutdown(socket.SHUT_RDWR)
                                self.connection.close()
                                return
                            status = fault["status"] or status
                            if fault["response"] is not None:
                                response = fault["response"]
                    self.reply(status, response)
                except (ValueError, KeyError, TypeError):
                    self.reply(422, {"message": "fixture input invalid"})

            def reply(self, status, body):
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.opener = LoopbackOpener(self.url, self.token)
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def fail_next(self, method, path, *, status=None, after=False, disconnect=False, response=None):
        with self.lock:
            self.faults.append(
                {
                    "method": method,
                    "path": path,
                    "status": status,
                    "after": after,
                    "disconnect": disconnect,
                    "response": response,
                }
            )

    def _fault(self, method, path):
        for index, fault in enumerate(self.faults):
            if fault["method"] == method and fault["path"] == path:
                return self.faults.pop(index)
        return None

    def _tree(self, entries):
        files = [dict(e) for e in entries if e["type"] != "tree"]
        directories = {""}
        for entry in files:
            parts = entry["path"].split("/")
            directories.update("/".join(parts[:i]) for i in range(1, len(parts)))
        directory_shas = {}
        tree_entries = list(files)
        for directory in sorted(
            directories, key=lambda value: value.count("/") + bool(value), reverse=True
        ):
            children = []
            for entry in tree_entries:
                parent, _, name = entry["path"].rpartition("/")
                if parent == directory:
                    children.append((name, entry))
            children.sort(key=lambda pair: pair[0] + ("/" if pair[1]["type"] == "tree" else ""))
            raw = b"".join(
                entry["mode"].lstrip("0").encode()
                + b" "
                + name.encode()
                + b"\0"
                + bytes.fromhex(entry["sha"])
                for name, entry in children
            )
            sha = _sha("tree", raw)
            directory_shas[directory] = sha
            if directory:
                tree_entries.append(
                    {"path": directory, "mode": "040000", "type": "tree", "sha": sha}
                )
        sha = directory_shas[""]
        self.trees[sha] = sorted(tree_entries, key=lambda entry: entry["path"])
        return sha

    def _commit(self, payload):
        tree, parents, message = payload["tree"], payload["parents"], payload["message"]
        content = "tree " + tree + "\n" + "".join("parent " + parent + "\n" for parent in parents)
        content += (
            "author Fixture <fixture@example.invalid> 0 +0000\n"
            "committer Fixture <fixture@example.invalid> 0 +0000\n\n" + message + "\n"
        )
        sha = _sha("commit", content.encode())
        commit = {
            "sha": sha,
            "tree": {"sha": tree},
            "parents": [{"sha": p} for p in parents],
            "message": message,
        }
        self.commits[sha] = commit
        return copy.deepcopy(commit)

    def _ref(self, branch):
        sha = self.refs.get(branch)
        if sha is None:
            return 404, {"message": "not found"}
        return 200, {"ref": "refs/heads/" + branch, "object": {"type": "commit", "sha": sha}}

    def _route(self, method, path, payload):
        parsed = urlsplit(path)
        prefix = "/repos/" + self.repo
        route = unquote(parsed.path.removeprefix(prefix))
        if not parsed.path.startswith(prefix + "/"):
            return 404, {}
        if method == "GET":
            if route == "/_fixture/observations":
                return 200, {
                    "mutations": [
                        {"method": r["method"], "path": r["path"]}
                        for r in self.requests
                        if r["method"] != "GET"
                    ],
                    "branches": dict(self.refs),
                    "prs": copy.deepcopy(self.pulls),
                }
            if route.startswith("/git/ref/heads/"):
                return self._ref(route.removeprefix("/git/ref/heads/"))
            if route.startswith("/git/commits/"):
                item = self.commits.get(route.removeprefix("/git/commits/"))
                return (200, copy.deepcopy(item)) if item else (404, {})
            if route.startswith("/git/trees/"):
                sha = route.removeprefix("/git/trees/")
                return (
                    (200, {"sha": sha, "truncated": False, "tree": copy.deepcopy(self.trees[sha])})
                    if sha in self.trees
                    else (404, {})
                )
            if route.startswith("/git/blobs/"):
                sha = route.removeprefix("/git/blobs/")
                if sha not in self.blobs:
                    return 404, {}
                raw = self.blobs[sha]
                return 200, {
                    "sha": sha,
                    "size": len(raw),
                    "encoding": "base64",
                    "content": base64.b64encode(raw).decode(),
                }
            if route == "/pulls":
                query = parse_qs(parsed.query)
                items = self.pulls
                if "head" in query:
                    owner, _, branch = query["head"][0].partition(":")
                    items = [
                        p
                        for p in items
                        if p["head"]["ref"] == branch and owner == self.repo.split("/")[0]
                    ]
                if "base" in query:
                    items = [p for p in items if p["base"]["ref"] == query["base"][0]]
                if query.get("state", ["open"])[0] != "all":
                    items = [p for p in items if p["state"] == query.get("state", ["open"])[0]]
                return 200, copy.deepcopy(items[:100])
            if route.startswith("/pulls/"):
                items = [p for p in self.pulls if str(p["number"]) == route.removeprefix("/pulls/")]
                return (200, copy.deepcopy(items[0])) if items else (404, {})
        if method == "POST":
            if route == "/git/trees":
                entries = {
                    e["path"]: dict(e)
                    for e in self.trees[payload["base_tree"]]
                    if e["type"] != "tree"
                }
                for entry in payload["tree"]:
                    name = entry["path"]
                    if entry.get("sha", "missing") is None:
                        del entries[name]
                    else:
                        raw = entry["content"].encode()
                        sha = _sha("blob", raw)
                        self.blobs[sha] = raw
                        entries[name] = {
                            "path": name,
                            "mode": entry["mode"],
                            "type": "blob",
                            "sha": sha,
                            "size": len(raw),
                        }
                sha = self._tree(list(entries.values()))
                return 201, {"sha": sha, "truncated": False, "tree": copy.deepcopy(self.trees[sha])}
            if route == "/git/commits":
                return 201, self._commit(payload)
            if route == "/git/refs":
                branch = payload["ref"].removeprefix("refs/heads/")
                if branch in self.refs:
                    return 422, {"message": "already exists"}
                self.refs[branch] = payload["sha"]
                _, response = self._ref(branch)
                return 201, response
            if route == "/pulls":
                head, base = payload["head"], payload["base"]
                if ":" in head:
                    head = head.split(":", 1)[1]
                if any(p["head"]["ref"] == head and p["base"]["ref"] == base for p in self.pulls):
                    return 422, {"message": "already exists"}
                pr = {
                    "number": len(self.pulls) + 1,
                    "state": "open",
                    "draft": payload["draft"],
                    "title": payload["title"],
                    "body": payload["body"],
                    "head": {"ref": head, "sha": self.refs[head], "repo": {"full_name": self.repo}},
                    "base": {"ref": base, "sha": self.refs[base], "repo": {"full_name": self.repo}},
                }
                pr["html_url"] = f"https://github.com/{self.repo}/pull/{pr['number']}"
                self.pulls.append(pr)
                return 201, copy.deepcopy(pr)
        return 404, {"message": "fixture route absent"}
