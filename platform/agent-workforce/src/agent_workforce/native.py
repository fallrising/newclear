"""Trusted, bounded native CLI ports. Local exit never resolves remote effects.

Profiles are operator configuration, not message data. The controller bridge
keeps M1 admission/reservations; the runner can also qualify a profile against
an explicitly authorized synthetic fixture before any runtime promotion.
"""
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import uuid


class NativeError(ValueError):
    """Unusable profile, conflicting intent, or unproven continuity."""


def _encoded(value):
    def check(item, depth=0):
        if depth > 40:
            raise NativeError("JSON depth")
        if item is None or type(item) in (str, bool, int):
            return
        if type(item) is float and math.isfinite(item):
            return
        if type(item) is list:
            for child in item:
                check(child, depth + 1)
            return
        if type(item) is dict and all(type(key) is str for key in item):
            for child in item.values():
                check(child, depth + 1)
            return
        raise NativeError("finite JSON required")
    try:
        check(value)
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError) as exc:
        raise NativeError("invalid JSON") from exc
    if len(raw) > 65536:
        raise NativeError("JSON exceeds 64 KiB")
    return raw


def _digest(value):
    return hashlib.sha256(_encoded(value)).hexdigest()


def _text(value, name):
    if type(value) is not str or not value.strip() or len(value.encode("utf-8")) > 65536 or "\0" in value:
        raise NativeError(name)
    return value


def _hash_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def configuration_digest(provider, workspace):
    """Known policy-file observations for the explicit native command profile.

    This is not authentication/entitlement evidence or a complete plugin audit.
    User routing configuration is excluded by the command, while managed
    policy, project configuration and Codex execpolicy remain in force.
    """
    workspace = Path(workspace)
    home = Path.home()
    if provider == "codex":
        base = Path(os.environ.get("CODEX_HOME", home / ".codex"))
        paths = [workspace / ".codex/config.toml", Path("/etc/codex/managed_config.toml"),
                 Path("/etc/codex/requirements.toml"), base / "requirements.toml"]
        for directory in (base / "rules", workspace / ".codex/rules"):
            if directory.exists():
                paths.extend(sorted(directory.glob("*.rules")))
        variables = ("OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL")
    elif provider == "claude":
        paths = [workspace / ".claude/settings.json", workspace / ".claude/settings.local.json",
                 workspace / ".mcp.json", Path("/etc/claude-code/managed-settings.json")]
        variables = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL")
    else:
        raise NativeError("native provider")
    if len(paths) > 64:
        raise NativeError("policy file bound")
    observations = []
    for path in paths:
        if any(p.is_symlink() for p in (path, *path.parents)):
            raise NativeError("policy path symlink")
        if path.exists():
            if not path.is_file() or path.stat().st_size > 262144:
                raise NativeError("policy file bound")
            observations.append([str(path), _hash_file(path)])
        else:
            observations.append([str(path), None])
    presence = {key: bool(os.environ.get(key)) for key in variables}
    if any(presence.values()):
        raise NativeError("explicit native login profile excludes API/routing overrides")
    return _digest(dict(provider=provider, files=observations, env_presence=presence,
                        code_profile="native-login-v1"))


@dataclass(frozen=True)
class NativeProfile:
    provider: str
    binary: str
    binary_sha256: str
    model: str
    role: str
    harness_version: str
    config_digest: str
    account_ref: str
    route_id: str
    route_revision: int
    profile_revision: int
    workspace: str
    workspace_binding_key: str
    timeout_seconds: float
    resume_verified: bool = False

    def __post_init__(self):
        if (self.provider, self.role) not in (("codex", "writer"), ("claude", "reviewer")):
            raise NativeError("only Codex writer and Claude reviewer profiles")
        for key in ("account_ref", "route_id", "harness_version", "workspace_binding_key"):
            _text(getattr(self, key), key)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}", self.model):
            raise NativeError("exact model")
        for key in ("binary_sha256", "config_digest"):
            if not re.fullmatch(r"[0-9a-f]{64}", getattr(self, key)):
                raise NativeError(key)
        for key in ("route_revision", "profile_revision"):
            if type(getattr(self, key)) is not int or getattr(self, key) < 1:
                raise NativeError(key)
        if (type(self.timeout_seconds) not in (int, float) or not math.isfinite(self.timeout_seconds)
                or not 0 < self.timeout_seconds <= 1800 or type(self.resume_verified) is not bool):
            raise NativeError("timeout or capability")
        self.check_environment()

    def check_environment(self):
        binary, workspace = Path(self.binary), Path(self.workspace)
        if (not binary.is_absolute() or str(binary.resolve()) != self.binary
                or not binary.is_file() or not os.access(binary, os.X_OK)
                or not workspace.is_absolute() or str(workspace.resolve()) != self.workspace
                or not workspace.is_dir() or _hash_file(binary) != self.binary_sha256):
            raise NativeError("binary/workspace drift")
        if configuration_digest(self.provider, self.workspace) != self.config_digest:
            raise NativeError("native policy configuration drift")

    def command(self, prompt, result_path, *, session_id=None, resume=False):
        _text(prompt, "prompt")
        if len(prompt.encode("utf-8")) > 3000:
            raise NativeError("native prompt exceeds bounded argv profile")
        self.check_environment()
        if resume and (not self.resume_verified or not session_id):
            raise NativeError("native resume unverified")
        if session_id is not None:
            _text(session_id, "native session")
            if session_id.startswith("-") or any(ord(c) < 32 for c in session_id):
                raise NativeError("native session")
        if self.provider == "codex":
            # User execpolicy rules and managed requirements still apply.
            argv = [self.binary, "-a", "never", "--sandbox", "workspace-write", "exec",
                    "--ignore-user-config", "--disable", "multi_agent", "--model", self.model,
                    "--json", "--output-last-message", str(result_path)]
            if resume:
                argv += ["resume", session_id]
            return argv + [prompt]
        settings = {"sandbox": {"enabled": True, "failIfUnavailable": True,
                                "allowUnsandboxedCommands": False},
                    "permissions": {"allow": ["Read", "Glob", "Grep"],
                                    "deny": ["Edit", "Write", "Bash", "Agent", "Task", "mcp__*"]}}
        argv = [self.binary, "--setting-sources", "project,local", "-p", prompt,
                "--model", self.model, "--permission-mode", "dontAsk", "--permission-prompts", "none",
                "--tools", "Read,Glob,Grep", "--disallowedTools", "Edit,Write,Bash,Agent,Task,mcp__*",
                "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                "--disable-slash-commands", "--settings", json.dumps(settings, sort_keys=True),
                "--output-format", "stream-json", "--verbose"]
        return argv + (["--resume", session_id] if resume else ["--session-id", session_id or str(uuid.uuid4())])


class NativeRunner:
    """A private operation/session journal over one process owner.

    Same-UID mutation is outside this trusted boundary. No operation is retried
    after an intent, including exceptions or a controller receipt gap.
    """

    def __init__(self, root, *, supervisor=None, session_source=None):
        from .native_process import ProcessSupervisor
        self.root = Path(root).absolute()
        if any(p.is_symlink() for p in (self.root, *self.root.parents)):
            raise NativeError("journal symlink")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = self.root.stat()
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise NativeError("private journal required")
        self.supervisor = supervisor or ProcessSupervisor(self.root / "processes")
        if session_source is not None:
            from .native_session_source import CodexSessionSource
            from .native_reaping import ReapingProcessSupervisor
            if (not isinstance(session_source, CodexSessionSource)
                    or not isinstance(self.supervisor, ReapingProcessSupervisor)):
                raise NativeError("session evidence requires trusted source and reaping supervisor")
        self.session_source = session_source

    @contextmanager
    def _lock(self):
        fd = os.open(self.root / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            self._private(fd)
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    @staticmethod
    def _private(fd):
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
            raise NativeError("unsafe journal file")

    def _path(self, kind, key):
        _text(key, kind)
        return self.root / (kind + "-" + hashlib.sha256(key.encode()).hexdigest() + ".json")

    def _read(self, path):
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return None
        try:
            self._private(fd)
            with os.fdopen(fd, "rb", closefd=False) as stream:
                raw = stream.read(65537)
            if len(raw) > 65536:
                raise NativeError("journal size")
            def pairs(items):
                out = {}
                for key, value in items:
                    if key in out:
                        raise NativeError("duplicate journal key")
                    out[key] = value
                return out
            value = json.loads(raw, object_pairs_hook=pairs)
            _encoded(value)
            if type(value) is not dict:
                raise NativeError("journal object")
            return value
        finally:
            os.close(fd)

    def _write(self, path, value):
        self._read(path)  # Reject an unsafe existing target before replacement.
        temporary = self.root / ("write-" + uuid.uuid4().hex)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(_encoded(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _reject_orphan_session(self, session_key):
        """Fail closed on old operation-before-claim gaps; never repair by retry.

        Only needed when the session index is absent. Bound the recovery scan
        to 4096 directory entries; larger journals require operator inspection.
        """
        with os.scandir(self.root) as entries:
            for count, entry in enumerate(entries, 1):
                if count > 4096:
                    raise NativeError("session recovery scan bound")
                if entry.name.startswith("operation-") and entry.name.endswith(".json"):
                    record = self._read(Path(entry.path))
                    try:
                        key = record["stable"]["binding"]["session_binding_key"]
                    except (KeyError, TypeError) as exc:
                        raise NativeError("incomplete operation journal") from exc
                    if key == session_key:
                        raise NativeError("session claim missing for existing operation")

    @staticmethod
    def _matches_process(record, process):
        if not record or type(process) is not dict or process.get("operation_id") != record.get("operation_id"):
            return False
        try:
            expected = dict(record["stable"], signature=record["signature"])
            return _encoded(process.get("binding")) == _encoded(expected)
        except (KeyError, TypeError, NativeError):
            return False

    def run(self, operation_id, profile, prompt, binding, *, resume_from=None, reconstruct_from=None):
        if not isinstance(profile, NativeProfile) or type(binding) is not dict:
            raise NativeError("trusted profile/binding required")
        binding = json.loads(_encoded(binding))
        _text(prompt, "prompt")
        if resume_from and reconstruct_from:
            raise NativeError("one continuity mode")
        spec = dict(profile=asdict(profile), prompt=prompt, binding=binding,
                    resume_from=resume_from, reconstruct_from=reconstruct_from)
        signature = _digest(spec)
        path = self._path("operation", operation_id)
        session_key = _text(binding.get("session_binding_key"), "session binding")
        session_path = self._path("session", session_key)
        stable = dict(profile=asdict(profile), binding=binding)
        created = False
        with self._lock():
            previous = self._read(path)
            if previous is not None:
                if previous.get("signature") != signature:
                    raise NativeError("operation identity conflict")
            else:
                created = True
                if self.session_source is not None:
                    if profile.provider != "codex" or resume_from or reconstruct_from:
                        raise NativeError("session evidence supports fresh Codex operations only")
                    source_intent = self.session_source.prepare(dict(
                        cwd=profile.workspace, model=profile.model,
                        cli_version=profile.harness_version,
                        prompt_sha256=hashlib.sha256(prompt.encode("utf-8")).hexdigest()))
                    stable["session_source"] = source_intent
                session = self._read(session_path)
                if session is None:
                    self._reject_orphan_session(session_key)
                native_id = None
                parent = resume_from or reconstruct_from
                if parent:
                    prior = self._read(self._path("operation", parent))
                    if not prior or not prior.get("effects_evidence") or not prior.get("local_stopped"):
                        raise NativeError("prior operation not reconciled")
                    if resume_from:
                        if not profile.resume_verified or prior["stable"] != stable or not prior.get("native_id"):
                            raise NativeError("resume binding/capability mismatch")
                        native_id = prior["native_id"]
                    elif prior["stable"]["binding"]["session_binding_key"] == session_key:
                        raise NativeError("reconstruct requires new binding")
                if session and (not resume_from or session.get("operation_id") != resume_from
                                or session.get("stable") != stable or session.get("native_id") != native_id):
                    raise NativeError("session already bound; explicit proven resume required")
                if not resume_from and profile.provider == "claude":
                    native_id = str(uuid.uuid4())
                previous = dict(operation_id=operation_id, signature=signature, stable=stable,
                                native_id=native_id, expected_native_id=native_id,
                                effects_evidence=None, local_stopped=False, lineage=parent)
                # Both intent and claim precede process creation. A partial pair
                # remains a blocking gap, never permission to create a new ID.
                # Claim first: even a failure before the operation intent leaves
                # a blocking claim, including an interrupted explicit resume.
                self._write(session_path, dict(operation_id=operation_id, stable=stable, native_id=native_id))
                self._write(path, previous)
        if not created:
            return self.inspect(operation_id)
        # Reopened intents must never run: only this invocation owns creation.
        # The marker is persisted before the supervisor's independent intent.
        with self._lock():
            current = self._read(path)
            if current.get("process_started"):
                return self._unknown(operation_id)
            current["process_started"] = True
            self._write(path, current)
        argv = profile.command(prompt, self.root / ("result-" + _digest(operation_id)),
                               session_id=previous["native_id"], resume=bool(resume_from))
        self.supervisor.execute(operation_id, argv, profile.workspace,
                                binding=dict(stable, signature=signature), timeout_seconds=profile.timeout_seconds)
        return self.inspect(operation_id)

    @staticmethod
    def _unknown(operation_id):
        return dict(operation_id=operation_id, status="unknown", stopped=False, effects_resolved=False, result=None)

    def inspect(self, operation_id):
        from .native_events import NativeEventError, normalize_events
        with self._lock():
            record = self._read(self._path("operation", operation_id))
        if record is None:
            return self._unknown(operation_id)
        process = self.supervisor.inspect(operation_id)
        if not self._matches_process(record, process):
            return self._unknown(operation_id)
        stopped = process.get("stopped") is True
        status = "unknown"
        normalized = None
        parse_error = None
        if (process.get("status") == "exited" and (stopped or process.get("leader_stopped") is True)
                and not process.get("output_limited") and not process.get("timed_out")):
            try:
                raw_path = Path(process["stdout_path"])
                if raw_path.is_symlink():
                    raise NativeError("stdout symlink")
                with raw_path.open("rb") as stream:
                    raw = stream.read(2097153)
                normalized = normalize_events(record["stable"]["profile"]["provider"], raw,
                                              expected_session_id=record["expected_native_id"])
                status = normalized["status"]
                if process.get("exit_code") != 0 and status == "complete":
                    status = "failed"
            except (NativeEventError, NativeError, OSError, KeyError) as exc:
                parse_error = type(exc).__name__
        elif process.get("status") == "running":
            status = "running"
        result = dict(native=normalized, process=process, parse_error=parse_error,
                      lineage=record.get("lineage"))
        if "session_source" in record["stable"]:
            # Never infer evidence policy for a legacy operation. Source intent
            # is bound before spawn, and only the reaper validates closure.
            from .native_reaping import ReapingProcessSupervisor
            from .native_session_source import CodexSessionSource, SessionSourceError
            from .native_session_events import normalize_session, SessionEventError
            session_summary = None
            source_error = None
            seal = None
            if (isinstance(self.supervisor, ReapingProcessSupervisor) and stopped
                    and normalized and normalized.get("session_id")
                    and process.get("containment_proof")):
                try:
                    intent = record["stable"]["session_source"]
                    with self._lock():
                        captured = CodexSessionSource.restore(intent).capture(
                            intent, normalized["session_id"], self.root,
                            binding_digest=_digest(dict(record["stable"], signature=record["signature"])),
                            closure_digest=_digest(process["containment_proof"]),
                            expected_seal=record.get("session_seal"))
                    seal = captured["manifest"]
                    session_summary = normalize_session(captured["raw"], expected=dict(
                        intent["expected"], session_id=normalized["session_id"]))
                    if session_summary["status"] == "failed":
                        status = "failed"
                    elif session_summary["status"] != "complete" and status != "failed":
                        status = "unknown"
                except (SessionSourceError, SessionEventError, NativeError, OSError, KeyError) as exc:
                    source_error = type(exc).__name__
                    if status != "failed":
                        status = "unknown"
            else:
                source_error = "session_prerequisite_missing"
                if status not in ("failed", "running"):
                    status = "unknown"
            result.update(session=session_summary, session_seal=seal, session_error=source_error)
        # Keep bounded raw output outside SQLite; normalized metadata can also
        # be oversized and must not be silently truncated into a success.
        try:
            _encoded(result)
        except NativeError:
            result = dict(native=None, process_status=process.get("status"), parse_error="metadata_limit")
            status = "unknown"
        with self._lock():
            record = self._read(self._path("operation", operation_id))
            if normalized and normalized.get("session_id"):
                native_id = normalized["session_id"]
                if record.get("native_id") not in (None, native_id):
                    return self._unknown(operation_id)
                record["native_id"] = native_id
                record["expected_native_id"] = native_id
                session_path = self._path("session", record["stable"]["binding"]["session_binding_key"])
                session = self._read(session_path)
                if session and session["operation_id"] == operation_id:
                    session["native_id"] = native_id
                    self._write(session_path, session)
            if "session_source" in record["stable"] and seal is not None:
                if record.get("session_seal") not in (None, seal):
                    return self._unknown(operation_id)
                record["session_seal"] = seal
            record["local_stopped"] = stopped
            receipt = dict(operation_id=operation_id, status=status, stopped=stopped,
                           effects_resolved=stopped and bool(record.get("effects_evidence")), result=result)
            record["receipt"] = receipt
            try:
                # The stable source baseline is also stored in the process
                # binding. Bound the complete durable record, not only result.
                _encoded(record)
            except NativeError:
                receipt["status"] = "unknown"
                receipt["result"] = dict(native=None, process_status=process.get("status"),
                                         parse_error="metadata_limit")
            self._write(self._path("operation", operation_id), record)
            return json.loads(_encoded(receipt))

    def stop(self, operation_id):
        with self._lock():
            record = self._read(self._path("operation", operation_id))
        if not self._matches_process(record, self.supervisor.inspect(operation_id)):
            return self._unknown(operation_id)
        self.supervisor.stop(operation_id)
        receipt = self.inspect(operation_id)
        if receipt["stopped"] and receipt["status"] not in ("complete", "failed"):
            receipt["status"] = "stopped"
        return receipt

    def attest_effects(self, operation_id, evidence_ref):
        """Trusted operator boundary; never call with a model's self-report."""
        _text(evidence_ref, "trusted effects evidence reference")
        receipt = self.inspect(operation_id)
        if receipt["stopped"] is not True:
            raise NativeError("local stop not proven")
        with self._lock():
            path = self._path("operation", operation_id)
            record = self._read(path)
            if record is None:
                raise NativeError("unknown operation")
            record["effects_evidence"] = evidence_ref
            self._write(path, record)
        return self.inspect(operation_id)


class NativeBackend:
    """M1 backend port mapped from committed trusted records, never body argv."""

    def __init__(self, store, *, runner, profiles, clock):
        self.store, self.runner = store, runner
        if not callable(clock):
            raise NativeError("trusted controller clock required")
        self.clock = clock
        self.profiles = dict(profiles)
        if any(not isinstance(value, NativeProfile) or key != value.route_id for key, value in self.profiles.items()):
            raise NativeError("profile mapping")

    def start(self, operation_id, *, command_id, attempt_id):
        prepared = self.prepare(operation_id, command_id=command_id, attempt_id=attempt_id)
        return self.runner.run(operation_id, **prepared)

    def describe_capabilities(self, route_id):
        profile = self.profiles[route_id]
        return dict(provider=profile.provider, role=profile.role, structured_events="supported",
                    explicit_resume="unverified", whole_tree_stop="unknown", remote_cancel="unknown",
                    continuity="blocked_without_stop_proof", provider_requests=None, billing=None)

    def prepare(self, operation_id, *, command_id, attempt_id):
        """Resolve a committed intent without starting a process."""
        if self.store._depth:
            raise NativeError("committed intent required")
        attempt, command = self.store.attempt(attempt_id), self.store.command(command_id)
        if (not attempt or not command or attempt["operation_id"] != operation_id
                or attempt["command_id"] != command_id or attempt["state"] != "dispatch_prepared"):
            raise NativeError("prepared operation mismatch")
        request = command["input_payload"]
        profile = self.profiles.get(request["route_id"])
        if profile is None:
            raise NativeError("unconfigured native route")
        route = attempt["route"]
        session = self.store.get_record("sessions", request["session_binding_id"])
        workspace = self.store.get_record("resources", session["workspace_ref"]) if session else None
        worker = self.store.get_record("workers", request["worker_id"])
        if (not workspace or not worker or worker["role"] != profile.role
                or route["model"] != profile.model or route["account_ref"] != profile.account_ref
                or route["harness_version"] != profile.harness_version or route["revision"] != profile.route_revision
                or request["profile_revision"] != profile.profile_revision
                or workspace["binding_key"] != profile.workspace_binding_key):
            raise NativeError("trusted route/binding drift")
        now = self.clock()
        if type(now) not in (int, float) or not math.isfinite(now):
            raise NativeError("finite trusted clock required")
        remaining = attempt["lease_until"] - now
        if (remaining <= 0 or attempt["lease_expired"]
                or attempt["controller_epoch"] != self.store.controller_epoch):
            raise NativeError("prepared native lease expired")
        current_profile = self.store.get_record("profiles", route["profile_id"])
        profile = replace(profile, timeout_seconds=min(profile.timeout_seconds, remaining,
                                                       current_profile["timeout_seconds"]))
        binding = dict(worker_id=request["worker_id"], job_id=request["job_id"],
                       session_binding_id=request["session_binding_id"], session_binding_key=session["binding_key"],
                       input_revision=request["input_revision"], ac_revision=request["ac_revision"])
        prompt = ("Perform this bounded operator-authorized " + profile.role + " task. "
                  "Do not delegate, change permissions, access credentials, commit, publish or expand scope.\n"
                  + _encoded(dict(input=request["input"], resource_scopes=request["resource_scopes"])).decode())
        return dict(profile=profile, prompt=prompt, binding=binding)

    def inspect(self, operation_id):
        return self.runner.inspect(operation_id)

    def stop(self, operation_id):
        return self.runner.stop(operation_id)

    observe = inspect
    reconcile = inspect
    cancel = stop

    def resume(self, *args, **kwargs):
        raise NativeError("native resume has no qualified whole-tree stop proof")
