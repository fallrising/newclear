"""Closed read-only GitHub operation projection for synthetic loopback fixtures."""

import base64
import binascii
from dataclasses import dataclass

from ..domain import Problem
from .policy import MAX_FILE, SHA, normalize_request
from .transport import MockTransport


def require(condition):
    if not condition:
        raise Problem(502, "tool_upstream_schema")


def sha(value):
    require(type(value) is str and SHA.fullmatch(value))
    return value


def text(value):
    require(type(value) is str and all(not 0xD800 <= ord(char) <= 0xDFFF for char in value))
    return value


@dataclass(frozen=True)
class Result:
    value: dict
    http_calls: int
    response_bytes: int


class Adapter:
    def __init__(self, policy):
        self.policy = policy

    def execute(self, payload, *, before_hop):
        payload = normalize_request(self.policy, payload)
        transport = MockTransport(self.policy, before_hop)
        root = self.policy.repository_path
        repository = transport.get(root)
        require(type(repository.get("id")) is int and repository["id"] == self.policy.repository_id)
        require(repository.get("full_name") == f"{self.policy.owner}/{self.policy.repository}")
        require(type(repository.get("private")) is bool)
        operation = payload["operation"]
        if operation == "github.repository.get":
            value = {key: repository[key] for key in ("id", "full_name", "private")}
        elif operation == "github.issue.get":
            issue = transport.get(f"{root}/issues/{payload['issue_number']}")
            require(type(issue.get("number")) is int and issue["number"] == payload["issue_number"])
            require(issue.get("state") in ("open", "closed"))
            require(issue.get("body") is None or type(issue.get("body")) is str)
            # Pull requests share GitHub issue endpoints but are not this operation.
            require("pull_request" not in issue)
            value = {
                "number": issue["number"],
                "title": text(issue.get("title")),
                "body": text(issue["body"]) if issue.get("body") is not None else None,
                "state": issue["state"],
            }
        else:
            value = self.file(transport, root, payload)
        transport.remaining()
        return Result(value, transport.http_calls, transport.response_bytes)

    def file(self, transport, root, payload):
        commit = transport.get(f"{root}/git/commits/{self.policy.commit}")
        require(commit.get("sha") == self.policy.commit and type(commit.get("tree")) is dict)
        tree_sha = sha(commit["tree"].get("sha"))
        segments = payload["path"].split("/")
        for index, segment in enumerate(segments):
            tree = transport.get(f"{root}/git/trees/{tree_sha}")
            require(tree.get("sha") == tree_sha and tree.get("truncated") is False)
            require(type(tree.get("tree")) is list)
            entries = tree["tree"]
            require(
                all(type(entry) is dict and type(entry.get("path")) is str for entry in entries)
            )
            require(len({entry["path"] for entry in entries}) == len(entries))
            matches = [entry for entry in entries if entry["path"] == segment]
            require(len(matches) == 1)
            entry = matches[0]
            entry_sha = sha(entry.get("sha"))
            if index < len(segments) - 1:
                require(entry.get("type") == "tree" and entry.get("mode") == "040000")
                tree_sha = entry_sha
            else:
                require(entry.get("type") == "blob" and entry.get("mode") in ("100644", "100755"))
        blob = transport.get(f"{root}/git/blobs/{entry_sha}")
        require(blob.get("sha") == entry_sha and blob.get("encoding") == "base64")
        require(type(blob.get("size")) is int and 0 <= blob["size"] <= MAX_FILE)
        encoded = text(blob.get("content"))
        try:
            # GitHub wraps base64 lines; only CR/LF are permitted whitespace.
            content = base64.b64decode(encoded.replace("\r", "").replace("\n", ""), validate=True)
        except (ValueError, binascii.Error):
            raise Problem(502, "tool_upstream_schema") from None
        require(len(content) == blob["size"] and len(content) <= MAX_FILE)
        if self.policy.secret.encode() in content:
            raise Problem(502, "tool_secret_echo")
        return {
            "path": payload["path"],
            "commit": self.policy.commit,
            "sha": entry_sha,
            "encoding": "base64",
            "size": len(content),
            "content": base64.b64encode(content).decode(),
        }
