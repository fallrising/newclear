import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from github_export_fixture import FakeGitHub, LoopbackOpener

from agent_platform.github_client import API_VERSION, GitHubClient, GitHubError


class Response(io.BytesIO):
    status = 200

    def __init__(self, data=b'{"ok":true}', headers=None, status=200):
        super().__init__(data)
        self.headers = headers or {"Content-Type": "application/json"}
        self.status = status


class Opener:
    def __init__(self, result=None):
        self.result = result or Response()
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class GitHubClientTests(unittest.TestCase):
    def test_fixed_origin_headers_and_json(self):
        opener = Opener()
        client = GitHubClient("synthetic-test-token", opener=opener)
        self.assertEqual(
            client.request("POST", "/repos/example/repo/git/trees", {"tree": []}), {"ok": True}
        )
        request, timeout = opener.requests[0]
        self.assertEqual(request.full_url, "https://api.github.com/repos/example/repo/git/trees")
        self.assertEqual(request.get_header("Authorization"), "Bearer synthetic-test-token")
        self.assertEqual(request.get_header("X-github-api-version"), API_VERSION)
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 30)
        self.assertEqual(json.loads(request.data), {"tree": []})

    def test_rejects_path_and_token_injection_before_io(self):
        opener = Opener()
        client = GitHubClient("test", opener=opener)
        for path in [
            "https://evil/repos/a/b",
            "//evil/repos/a/b",
            "/repos/a/b#x",
            "/repos/a/b\r\nX:y",
            "/repos/a/b/../x",
            "/repos/a/b/%2e%2e/x",
            "/repos/a/b/%0a",
            "/repos/a/b\\x",
        ]:
            with self.subTest(path=path), self.assertRaises(GitHubError) as raised:
                client.request("GET", path)
            self.assertFalse(raised.exception.uncertain)
        self.assertEqual(opener.requests, [])
        for token in ["bad\nvalue", "", "non ascii é"]:
            with self.assertRaises(GitHubError):
                GitHubClient(token)

    def test_get_404_and_conservative_mutation_errors(self):
        for method in ["GET", "POST"]:
            for status in [301, 403, 404, 429, 500]:
                with self.subTest(method=method, status=status):
                    opener = Opener(
                        HTTPError(
                            "https://api.github.com", status, "secret", {}, io.BytesIO(b"secret")
                        )
                    )
                    client = GitHubClient("test", opener=opener)
                    if method == "GET" and status == 404:
                        self.assertIsNone(client.request(method, "/repos/a/b"))
                    else:
                        with self.assertRaises(GitHubError) as raised:
                            client.request(method, "/repos/a/b", {} if method == "POST" else None)
                        self.assertEqual(raised.exception.uncertain, method == "POST")
                        self.assertNotIn("secret", str(raised.exception))
                    self.assertEqual(len(opener.requests), 1)

    def test_malformed_bounded_json_and_disconnect(self):
        for result in [
            Response(b'{"a":1,"a":2}'),
            Response(b'{"a":NaN}'),
            Response(b'{"a":1e999}'),
            Response(b'{"a":"\\ud800"}'),
            Response(b"not json"),
            Response(b"{}", {"Content-Type": "text/html"}),
            Response(b"{}", {"Content-Type": "application/json", "Content-Length": "9000000"}),
            Response(b"{}", {"Content-Type": "application/json", "Content-Encoding": "gzip"}),
            TimeoutError("credential secret"),
        ]:
            with self.subTest(result=result):
                opener = Opener(result)
                with self.assertRaises(GitHubError) as raised:
                    GitHubClient("test", opener=opener).request("POST", "/repos/a/b", {})
                self.assertTrue(raised.exception.uncertain)
                self.assertNotIn("secret", str(raised.exception))
                self.assertEqual(len(opener.requests), 1)

    def test_default_transport_disables_proxy_and_redirects(self):
        with patch.dict("os.environ", {"HTTPS_PROXY": "http://credential-leak.invalid"}):
            client = GitHubClient("test")
        proxies = [h for h in client.opener.handlers if hasattr(h, "proxies")]
        self.assertTrue(all(not h.proxies for h in proxies))
        handler = next(h for h in client.opener.handlers if hasattr(h, "redirect_request"))
        self.assertIsNone(handler.redirect_request(None, None, 302, "", {}, "https://evil.invalid"))

    def test_body_limits_and_declared_size_mismatch(self):
        for response in [
            Response(b" " * (8 * 1024 * 1024 + 1)),
            Response(b"{}", {"Content-Type": "application/json", "Content-Length": "1"}),
            Response(b"{}", {"Content-Type": "application/json", "Content-Length": "3"}),
        ]:
            with self.assertRaises(GitHubError) as raised:
                GitHubClient("test", opener=Opener(response)).request("GET", "/repos/a/b")
            self.assertEqual(raised.exception.code, "github_response_invalid")
            self.assertFalse(raised.exception.uncertain)
        opener = Opener()
        with self.assertRaises(GitHubError) as raised:
            GitHubClient("test", opener=opener).request(
                "POST", "/repos/a/b", {"huge": "x" * (8 * 1024 * 1024)}
            )
        self.assertFalse(raised.exception.uncertain)
        self.assertEqual(opener.requests, [])

    def test_loopback_transport_roundtrip_and_post_success_disconnect(self):
        with FakeGitHub(files={"dir/a.txt": b"one\n"}) as fake:
            client = GitHubClient(fake.token, opener=LoopbackOpener(fake.url))
            prefix = "/repos/" + fake.repo
            ref = client.request("GET", prefix + "/git/ref/heads/main")
            self.assertEqual(ref["object"]["sha"], fake.base_sha)
            commit = client.request("GET", prefix + "/git/commits/" + fake.base_sha)
            tree = client.request(
                "GET", prefix + "/git/trees/" + commit["tree"]["sha"] + "?recursive=1"
            )
            self.assertFalse(tree["truncated"])
            entry = next(e for e in tree["tree"] if e["path"] == "dir/a.txt")
            blob = client.request("GET", prefix + "/git/blobs/" + entry["sha"])
            self.assertEqual(blob["content"], "b25lCg==")
            new_tree = client.request(
                "POST",
                prefix + "/git/trees",
                {
                    "base_tree": fake.base_tree,
                    "tree": [
                        {
                            "path": "new.txt",
                            "type": "blob",
                            "mode": "100644",
                            "content": "created\n",
                        }
                    ],
                },
            )
            new_commit = client.request(
                "POST",
                prefix + "/git/commits",
                {"tree": new_tree["sha"], "parents": [fake.base_sha], "message": "test export"},
            )
            branch = "agent-platform/export-test"
            client.request(
                "POST",
                prefix + "/git/refs",
                {"ref": "refs/heads/" + branch, "sha": new_commit["sha"]},
            )
            fake.fail_next("POST", prefix + "/pulls", after=True, disconnect=True)
            with self.assertRaises(GitHubError) as raised:
                client.request(
                    "POST",
                    prefix + "/pulls",
                    {
                        "base": "main",
                        "head": branch,
                        "title": "test",
                        "body": "marker",
                        "draft": True,
                    },
                )
            self.assertTrue(raised.exception.uncertain)
            self.assertEqual(len(fake.pulls), 1)
            fake.pulls[0]["state"] = "closed"
            prs = client.request(
                "GET",
                prefix
                + "/pulls?state=all&head=example:agent-platform/export-test&base=main&per_page=100",
            )
            self.assertEqual((len(prs), prs[0]["draft"], prs[0]["body"]), (1, True, "marker"))
            observation = client.request("GET", prefix + "/_fixture/observations")
            self.assertEqual(len(observation["mutations"]), 4)
            self.assertNotIn(fake.token, json.dumps(observation))

    def test_loopback_fault_is_one_shot_and_mutations_never_retry(self):
        with FakeGitHub() as fake:
            client = GitHubClient(fake.token, opener=fake.opener)
            path = "/repos/example/repo/git/trees"
            fake.fail_next("POST", path, status=429)
            with self.assertRaises(GitHubError) as raised:
                client.request("POST", path, {"base_tree": fake.base_tree, "tree": []})
            self.assertTrue(raised.exception.uncertain)
            self.assertEqual(len(fake.requests), 1)
            self.assertEqual(len(fake.trees), 1)
            self.assertEqual(fake.faults, [])
            fake.fail_next(
                "GET", "/repos/example/repo/git/ref/heads/main", response={"malformed": True}
            )
            self.assertEqual(
                client.request("GET", "/repos/example/repo/git/ref/heads/main"), {"malformed": True}
            )

    def test_loopback_refuses_remote_origins_and_nonsynthetic_tokens(self):
        for url in [
            "https://127.0.0.1:1234",
            "http://evil.invalid:1234",
            "http://127.0.0.1:1234/path",
            "http://user@127.0.0.1:1234",
        ]:
            with self.assertRaises(ValueError):
                LoopbackOpener(url)
        with self.assertRaises(ValueError):
            LoopbackOpener("http://127.0.0.1:1234", "ghp_real_credential")
        opener = LoopbackOpener("http://127.0.0.1:1234")
        with self.assertRaises(GitHubError):
            GitHubClient("ghp_real_credential", opener=opener).request("GET", "/repos/a/b")


if __name__ == "__main__":
    unittest.main()
