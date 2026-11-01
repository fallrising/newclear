"""Independent credential owner; committed intents precede every GitHub mutation."""

import base64
import hashlib
import json
import re
from urllib.parse import quote, urlencode

from .config import export_targets
from .domain import Problem
from .export_patch import prepare_patch
from .export_service import PreviewInput, preview, require_target
from .github_client import GitHubClient, GitHubError
from .private_config import read_private_text
from .result_archive import read_archive

SHA = re.compile(r"[0-9a-f]{40}")


def invalid():
    return Problem(409, "export_remote_invalid")


def sha(value):
    if type(value) is not str or SHA.fullmatch(value) is None:
        raise invalid()
    return value


def mapping(value):
    if type(value) is not dict:
        raise invalid()
    return value


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def from_private_config(db, path):
    """Only this process opens an explicit private credential; no ambient discovery."""
    try:
        config = json.loads(read_private_text(path, max_bytes=16384))
        if type(config) is not dict or set(config) != {"targets", "credential_file"}:
            raise ValueError()
        targets = export_targets(config["targets"])
        token = read_private_text(config["credential_file"], max_bytes=4096).rstrip("\n")
        client = GitHubClient(token)
    except (ValueError, KeyError, TypeError, GitHubError):
        raise ValueError("export_config_invalid") from None
    return ExportWorker(db, targets, client)


class ExportWorker:
    def __init__(self, db, targets, client):
        self.db, self.targets, self.client = db, export_targets(targets), client

    def run_once(self):
        with self.db.transaction() as conn:
            candidates = conn.execute(
                "SELECT id FROM github_exports WHERE state IN ('queued','exporting') "
                "OR reconcile_requested ORDER BY created_at,id LIMIT 100"
            ).fetchall()
        for candidate in candidates:
            # This session stays pinned across remote I/O. State/intents use separate
            # committed transactions; process death closes the session and its lock.
            with self.db.transaction() as lock:
                locked = lock.execute(
                    "SELECT pg_try_advisory_lock(hashtextextended(%s,731047)) AS acquired",
                    (str(candidate["id"]),),
                ).fetchone()["acquired"]
                if not locked:
                    continue
                lock.commit()
                try:
                    with self.db.transaction() as conn:
                        op = conn.execute(
                            "SELECT * FROM github_exports WHERE id=%s", (candidate["id"],)
                        ).fetchone()
                    op["_lock"] = lock
                    if op["state"] == "queued":
                        self.update(op, state="exporting", stage="reading")
                        self.execute(op)
                        return True
                    if op["state"] == "exporting" or op["reconcile_requested"]:
                        self.reconcile(op)
                        return True
                finally:
                    try:
                        lock.execute(
                            "SELECT pg_advisory_unlock(hashtextextended(%s,731047))",
                            (str(candidate["id"]),),
                        )
                        lock.commit()
                    except BaseException:
                        # Never return a session containing an advisory lock to the pool.
                        lock.close()
                        raise
        return False

    def update(self, op, **changes):
        permitted = {
            "state",
            "stage",
            "reason",
            "tree_sha",
            "commit_sha",
            "pr_number",
            "pr_url",
            "reconcile_requested",
        }
        if not changes.keys() <= permitted:
            raise ValueError("export_update_invalid")
        op["_lock"].execute("SELECT 1")
        columns = ",".join(key + "=%s" for key in changes)
        with self.db.transaction() as conn:
            changed = conn.execute(
                f"UPDATE github_exports SET {columns} "
                "WHERE id=%s AND state=%s AND stage=%s RETURNING id",
                (*changes.values(), op["id"], op["state"], op["stage"]),
            ).fetchone()
            if changed is None:
                raise RuntimeError("export_ownership_lost")
        # A failed commit stops execution before updating in-memory dispatch authority.
        op.update(changes)

    def request(self, op, method, endpoint, payload=None):
        return self.client.request(method, f"/repos/{op['target_repo']}" + endpoint, payload)

    def validate_approval(self, op):
        require_target(self.targets, op["target_repo"], op["base_branch"])
        data = PreviewInput(
            artifact_id=op["artifact_id"],
            artifact_sha256=op["artifact_sha256"],
            target_repo=op["target_repo"],
            base_branch=op["base_branch"],
        )
        expected = preview(self.db, self.targets, op["run_id"], data)
        if any(
            str(op[key]) != str(expected[key])
            for key in ("artifact_id", "artifact_sha256", "base_sha", "branch", "approval_digest")
        ):
            raise Problem(409, "export_approval_changed")
        return expected

    def ref(self, op, branch):
        value = self.request(op, "GET", "/git/ref/heads/" + quote(branch, safe="/"))
        if value is None:
            return None
        value = mapping(value)
        obj = mapping(value.get("object"))
        if value.get("ref") != "refs/heads/" + branch or obj.get("type") != "commit":
            raise invalid()
        return sha(obj.get("sha"))

    def check_base(self, op):
        if self.ref(op, op["base_branch"]) != op["base_sha"]:
            raise Problem(409, "export_base_changed")

    def commit(self, op, commit_sha, *, owned=False):
        value = mapping(self.request(op, "GET", "/git/commits/" + sha(commit_sha)))
        if value.get("sha") != commit_sha:
            raise invalid()
        tree_sha = sha(mapping(value.get("tree")).get("sha"))
        if owned and (
            tree_sha != op["tree_sha"]
            or type(value.get("parents")) is not list
            or len(value["parents"]) != 1
            or mapping(value["parents"][0]).get("sha") != op["base_sha"]
            or value.get("message") != self.message(op)
        ):
            raise invalid()
        return tree_sha

    def tree(self, op, tree_sha):
        value = mapping(self.request(op, "GET", "/git/trees/" + sha(tree_sha) + "?recursive=1"))
        if (
            value.get("sha") != tree_sha
            or value.get("truncated") is not False
            or type(value.get("tree")) is not list
            or len(value["tree"]) > 100000
        ):
            raise invalid()
        entries = value["tree"]
        paths = set()
        for entry in entries:
            entry = mapping(entry)
            path = entry.get("path")
            if (
                type(path) is not str
                or not 1 <= len(path) <= 4096
                or path in paths
                or type(entry.get("type")) is not str
                or entry.get("type") not in {"tree", "blob", "commit"}
                or type(entry.get("mode")) is not str
                or entry.get("mode") not in {"040000", "100644", "100755", "120000", "160000"}
            ):
                raise invalid()
            sha(entry.get("sha"))
            paths.add(path)
        return entries

    def blob(self, op, blob_sha):
        value = mapping(self.request(op, "GET", "/git/blobs/" + sha(blob_sha)))
        if (
            value.get("sha") != blob_sha
            or value.get("encoding") != "base64"
            or type(value.get("size")) is not int
            or not 0 <= value["size"] <= 1024 * 1024
            or type(value.get("content")) is not str
            or len(value["content"]) > 2 * 1024 * 1024
        ):
            raise invalid()
        try:
            content = base64.b64decode(value["content"].replace("\n", ""), validate=True)
        except (ValueError, UnicodeError):
            raise invalid() from None
        if len(content) != value["size"] or git_blob(content) != blob_sha:
            raise invalid()
        return content

    def marker(self, op):
        return f"<!-- agent-platform-export:{op['id']}:{op['approval_digest']} -->"

    def message(self, op):
        return "Agent Platform result export\n\n" + self.marker(op)

    def intent(self, op, stage, endpoint, payload):
        # This commit is the sole authority to send one mutation. No recovery path
        # calls intent(), including a crash before the following request starts.
        op["_lock"].execute("SELECT 1")
        self.update(op, stage=stage)
        op["_lock"].execute("SELECT 1")
        return self.request(op, "POST", endpoint, payload)

    def validate_tree(self, op, base_tree, changes):
        expected = {
            e["path"]: (e["mode"], e["type"], e["sha"]) for e in base_tree if e["type"] != "tree"
        }
        for change in changes:
            if change.get("sha", "present") is None:
                expected.pop(change["path"], None)
            else:
                expected[change["path"]] = (
                    change["mode"],
                    "blob",
                    git_blob(change["content"].encode("utf-8")),
                )
        actual = {
            e["path"]: (e["mode"], e["type"], e["sha"])
            for e in self.tree(op, op["tree_sha"])
            if e["type"] != "tree"
        }
        if actual != expected:
            raise invalid()

    def execute(self, op):
        try:
            self.validate_approval(op)
            archive = json.loads(read_archive(self.db, op["run_id"], op["artifact_id"]))
            self.check_base(op)
            base_tree_sha = self.commit(op, op["base_sha"])
            base_tree = self.tree(op, base_tree_sha)
            changes = prepare_patch(
                archive["result"]["diff"], base_tree, lambda value: self.blob(op, value)
            )
            if self.ref(op, op["branch"]) is not None:
                raise Problem(409, "export_branch_exists")
            self.check_base(op)
            tree = mapping(
                self.intent(
                    op,
                    "tree_intent",
                    "/git/trees",
                    {
                        "base_tree": base_tree_sha,
                        "tree": changes,
                    },
                )
            )
            tree_sha = sha(tree.get("sha"))
            self.update(op, tree_sha=tree_sha)
            self.validate_tree(op, base_tree, changes)
            self.update(op, stage="tree_ready")
            commit = mapping(
                self.intent(
                    op,
                    "commit_intent",
                    "/git/commits",
                    {
                        "message": self.message(op),
                        "tree": tree_sha,
                        "parents": [op["base_sha"]],
                    },
                )
            )
            self.update(op, commit_sha=sha(commit.get("sha")))
            self.commit(op, op["commit_sha"], owned=True)
            self.update(op, stage="commit_ready")
            self.check_base(op)
            branch = mapping(
                self.intent(
                    op,
                    "branch_intent",
                    "/git/refs",
                    {
                        "ref": "refs/heads/" + op["branch"],
                        "sha": op["commit_sha"],
                    },
                )
            )
            if (
                branch.get("ref") != "refs/heads/" + op["branch"]
                or mapping(branch.get("object")).get("sha") != op["commit_sha"]
                or mapping(branch.get("object")).get("type") != "commit"
                or self.ref(op, op["branch"]) != op["commit_sha"]
            ):
                raise invalid()
            self.update(op, stage="branch_ready")
            self.check_base(op)
            result = self.intent(
                op,
                "pr_intent",
                "/pulls",
                {
                    "title": "Agent Platform result " + str(op["run_id"]),
                    "head": op["branch"],
                    "base": op["base_branch"],
                    "draft": True,
                    "body": "Verification: "
                    + archive["result"]["verification"]["status"]
                    + ". Review the archived result and patch before merging.\n\n"
                    + self.marker(op),
                },
            )
            number = self.validate_pr(op, result, require_draft=True)
            # A POST response alone cannot prove the saved object can be read back.
            observed = self.request(op, "GET", "/pulls/" + str(number))
            if self.validate_pr(op, observed, require_draft=True) != number:
                raise invalid()
            if self.ref(op, op["branch"]) != op["commit_sha"]:
                raise invalid()
            self.success(op, number)
        except (Problem, GitHubError) as error:
            uncertain = op["stage"].endswith("_intent")
            self.update(op, state="uncertain" if uncertain else "failed", reason=error.code)

    def validate_pr(self, op, value, *, require_draft=False):
        value = mapping(value)
        number = value.get("number")
        if (
            type(number) is not int
            or not 1 <= number < 2**63
            or type(value.get("body")) is not str
            or len(value["body"]) > 65536
            or value["body"].splitlines().count(self.marker(op)) != 1
            or type(value.get("state")) is not str
            or value.get("state") not in {"open", "closed"}
            or type(value.get("draft")) is not bool
            or (require_draft and value["draft"] is not True)
        ):
            raise invalid()
        for label, branch, commit_sha in (
            ("head", op["branch"], op["commit_sha"]),
            ("base", op["base_branch"], op["base_sha"]),
        ):
            ref = mapping(value.get(label))
            if (
                ref.get("ref") != branch
                or ref.get("sha") != commit_sha
                or mapping(ref.get("repo")).get("full_name") != op["target_repo"]
            ):
                raise invalid()
        return number

    def success(self, op, number):
        self.update(
            op,
            state="succeeded",
            stage="complete",
            reason=None,
            pr_number=number,
            pr_url=f"https://github.com/{op['target_repo']}/pull/{number}",
            reconcile_requested=False,
        )

    def reconcile(self, op):
        try:
            self.validate_approval(op)
            if not op["commit_sha"] or not op["tree_sha"]:
                raise Problem(409, "export_outcome_unknown")
            self.commit(op, op["commit_sha"], owned=True)
            if self.ref(op, op["branch"]) != op["commit_sha"]:
                raise Problem(409, "export_outcome_unknown")
            query = urlencode(
                {
                    "state": "all",
                    "head": op["target_repo"].split("/")[0] + ":" + op["branch"],
                    "base": op["base_branch"],
                    "per_page": 100,
                }
            )
            values = self.request(op, "GET", "/pulls?" + query)
            if type(values) is not list or len(values) >= 100:
                raise invalid()
            matches = []
            for value in values:
                # Every matching branch result must be exact; ambiguous or spoofed
                # entries prevent success, including unrelated closed PRs.
                matches.append(self.validate_pr(op, value))
            if len(matches) != 1:
                raise Problem(409, "export_outcome_unknown")
            number = matches[0]
            if self.validate_pr(op, self.request(op, "GET", "/pulls/" + str(number))) != number:
                raise invalid()
            if self.ref(op, op["branch"]) != op["commit_sha"]:
                raise invalid()
            self.success(op, number)
        except (Problem, GitHubError) as error:
            self.update(op, state="uncertain", reason=error.code, reconcile_requested=False)
