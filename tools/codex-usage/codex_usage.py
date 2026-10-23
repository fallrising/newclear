#!/usr/bin/env python3
"""Stateless read-only Codex ChatGPT subscription usage collector."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import selectors
import shutil
import signal
import stat
import subprocess
import time
from dataclasses import dataclass

VERSION = "1.0.0"
ACCOUNT = "account/read"
RATE = "account/rateLimits/read"
USAGE = "account/usage/read"
CYCLE_REASON = (
    "No complete token total aligned to this quota window was provided; "
    "daily/lifetime tokens and quota percentages are not substituted."
)
TARGET_LIMIT = 65536
PROTOCOL_LIMIT = 16 * 1024 * 1024


class E(Exception):
    def __init__(self, kind, code=None):
        self.kind, self.code = kind, code

    def public(self):
        return {"kind": self.kind, "rpc_code": self.code, "upstream_message": None}


def number(value):
    if type(value) not in (int, float):
        return None
    try:
        return value if math.isfinite(value) else None
    except OverflowError:
        return None


def integer(value):
    return value if type(value) is int and value >= 0 else None


def rate_percent(value):
    """The supported App Server window schema specifies a signed int32."""
    return value if type(value) is int and -(2 ** 31) <= value < 2 ** 31 else None


def remaining_percent(value):
    value = number(value)
    return None if value is None else max(0, min(100, 100 - value))


def reset_seconds(value, now):
    value = integer(value)
    return None if value is None else max(0, value - now)


def iso(value):
    value = integer(value)
    if value is None:
        return None
    try:
        return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, OverflowError, OSError):
        return None


def q(status="not_attempted", err=None):
    return {"status": status, "source_updated_at": None,
            "source_update_time_status": "unknown", "error": err.public() if err else None}


@dataclass(frozen=True)
class Options:
    codex: str = "codex"
    codex_home: str | None = None
    target_file: str | None = None
    timeout: float = 10.0


class RPC:
    def __init__(self, argv, env):
        self.sel = selectors.DefaultSelector()
        self.buf = bytearray()
        self.n = 1
        try:
            self.p = subprocess.Popen(
                argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, env=env, bufsize=0, start_new_session=True)
        except (OSError, ValueError):
            self.sel.close()
            raise E("process_start_failed") from None
        try:
            os.set_blocking(self.p.stdout.fileno(), False)
            self.sel.register(self.p.stdout, selectors.EVENT_READ)
        except (OSError, ValueError):
            self.close()
            raise E("process_start_failed") from None

    def send(self, value):
        data = (json.dumps(value, separators=(",", ":")) + "\n").encode()
        try:
            while data:
                written = self.p.stdin.write(data)
                if not written:
                    raise E("process_write_failed")
                data = data[written:]
            self.p.stdin.flush()
        except (OSError, ValueError):
            raise E("process_write_failed") from None

    def recv(self, deadline):
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise E("rpc_timeout")
            index = self.buf.find(b"\n")
            if index >= 0:
                raw = bytes(self.buf[:index])
                del self.buf[:index + 1]
                try:
                    value = json.loads(raw)
                except (ValueError, UnicodeError, RecursionError):
                    raise E("invalid_protocol_json") from None
                if not isinstance(value, dict):
                    raise E("invalid_protocol_envelope")
                return value
            try:
                if not self.sel.select(left):
                    raise E("rpc_timeout")
                chunk = os.read(self.p.stdout.fileno(), 65536)
            except (OSError, ValueError):
                raise E("process_read_failed") from None
            if not chunk:
                raise E("process_stdout_closed")
            self.buf.extend(chunk)
            if len(self.buf) > PROTOCOL_LIMIT:
                raise E("protocol_line_limit_exceeded")

    def call(self, method, params, timeout):
        rid = self.n
        self.n += 1
        self.send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            value = self.recv(deadline)
            if value.get("jsonrpc", "2.0") != "2.0":
                raise E("invalid_protocol_envelope")
            if "id" not in value and isinstance(value.get("method"), str):
                continue
            if type(value.get("id")) is not int:
                raise E("invalid_protocol_envelope")
            if value["id"] != rid:
                continue
            if ("result" in value) == ("error" in value):
                raise E("invalid_protocol_envelope")
            if "error" in value:
                error = value["error"]
                if not isinstance(error, dict):
                    raise E("invalid_protocol_envelope")
                code = error.get("code") if type(error.get("code")) is int else None
                message = str(error.get("message", "")).lower()
                if code in (401, 403) or "auth" in message or "login" in message:
                    kind = "authentication_failed_or_expired"
                elif code == -32601 or "method not found" in message:
                    kind = "method_unsupported"
                else:
                    kind = "upstream_rpc_error"
                raise E(kind, code)
            return value["result"]

    def notify(self, method, params):
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def close(self):
        if getattr(self, "closed", False):
            return
        self.closed = True
        try:
            try:
                self.p.stdin.close()
            except (OSError, ValueError):
                pass
            try:
                self.p.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass
            # The session/group belongs to this acquisition. Its leader may
            # already have exited while descendants still hold resources.
            try:
                os.killpg(self.p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            deadline = time.monotonic() + 1
            while True:
                self.p.poll()  # Reap the leader so it does not keep the group alive.
                try:
                    os.killpg(self.p.pid, 0)
                except ProcessLookupError:
                    break
                if time.monotonic() >= deadline:
                    try:
                        os.killpg(self.p.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    break
                time.sleep(0.01)
            try:
                self.p.wait(timeout=1)
            except subprocess.TimeoutExpired:
                raise E("process_cleanup_timeout") from None
        finally:
            self.sel.close()
            self.p.stdout.close()


def load_target(path):
    if not path:
        raise E("target_required")
    try:
        # Nonblocking open also rejects FIFOs/devices without waiting for a writer.
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise E("target_file_invalid")
            raw = stream.read(TARGET_LIMIT + 1)
        if len(raw) > TARGET_LIMIT:
            raise E("target_file_invalid")
        target = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError, UnicodeError, RecursionError):
        raise E("target_file_invalid") from None
    if not isinstance(target, dict):
        raise E("target_file_invalid")
    email = target.get("expected_email")
    if (not isinstance(email, str) or not email.strip() or len(email) > 320
            or target.get("use_current_cli_workspace") is not True
            or (target.get("expected_workspace_id") is not None
                and not isinstance(target["expected_workspace_id"], str))):
        raise E("target_file_invalid")
    return target


def verify_account(payload, target):
    account = payload.get("account", payload) if isinstance(payload, dict) else None
    if not isinstance(account, dict):
        raise E("account_response_invalid")
    if account.get("type") not in ("chatgpt", "ChatGPT"):
        raise E("chatgpt_subscription_auth_required")
    if (not isinstance(account.get("email"), str)
            or account["email"].casefold() != target["expected_email"].casefold()):
        raise E("target_account_mismatch")
    if target.get("expected_workspace_id") is not None:
        raise E("workspace_identity_unavailable_in_supported_adapter")
    if target.get("use_current_cli_workspace") is not True:
        raise E("current_cli_workspace_not_authorized")
    return {"account_type": "chatgpt", "account_email_verified": True,
            "workspace_identity_verified": False, "workspace_selection": "current_cli_workspace"}


def norm_window(name, value, now):
    value = value if isinstance(value, dict) else {}
    used = rate_percent(value.get("usedPercent"))
    reset = integer(value.get("resetsAt"))
    if iso(reset) is None:
        reset = None
    return {"name": name, "used_percent": used,
            "remaining_percent": remaining_percent(used),
            "window_duration_minutes": integer(value.get("windowDurationMins")),
            "resets_at_unix": reset, "resets_at": iso(reset),
            "seconds_until_reset": reset_seconds(reset, now), "source_updated_at": None,
            "cycle_tokens": None, "cycle_tokens_reason": CYCLE_REASON}


def normalize_rates(payload, now):
    if not isinstance(payload, dict):
        return None, ["rate_limits_payload_invalid"]
    indexed, compat = payload.get("rateLimitsByLimitId"), payload.get("rateLimits")
    items, issues = [], []
    if isinstance(indexed, dict):
        items.extend(indexed.items())
    elif indexed is not None:
        issues.append("rate_limits_index_invalid")
    if isinstance(compat, dict):
        items.append((compat.get("limitId"), compat))
    elif compat is not None:
        issues.append("rate_limits_compat_invalid")
    out, seen = [], set()
    for key, raw in items:
        if not isinstance(raw, dict):
            issues.append("rate_limit_bucket_invalid")
            continue
        ident = key if isinstance(key, str) else raw.get("limitId")
        dedupe = ident if isinstance(ident, str) else json.dumps(raw, sort_keys=True)
        if dedupe in seen:
            continue
        for field in ("limitId", "limitName"):
            if raw.get(field) is not None and not isinstance(raw[field], str):
                issues.append("rate_limit_metadata_invalid")
        windows = []
        for name in ("primary", "secondary"):
            value = raw.get(name)
            if value is None:
                continue
            if not isinstance(value, dict):
                issues.append("rate_limit_window_invalid")
                continue
            if rate_percent(value.get("usedPercent")) is None:
                issues.append("rate_limit_used_percent_invalid")
            for field in ("resetsAt", "windowDurationMins"):
                if value.get(field) is not None and integer(value[field]) is None:
                    issues.append("rate_limit_window_field_invalid")
            if integer(value.get("resetsAt")) is not None and iso(value["resetsAt"]) is None:
                issues.append("rate_limit_reset_invalid")
            windows.append(norm_window(name, value, now))
        if not windows:
            issues.append("rate_limit_windows_missing")
            continue
        seen.add(dedupe)
        out.append({"bucket": ident if isinstance(ident, str) and len(ident) < 80 else None,
                    "limit_name": raw.get("limitName") if isinstance(raw.get("limitName"), str)
                    and len(raw["limitName"]) < 80 else None, "windows": windows})
    if not out:
        issues.append("rate_limit_data_missing")
    return out or None, list(dict.fromkeys(issues))


def normalize_usage(payload):
    out = {"scope": "account_activity_not_quota_cycle", "summary": None,
           "daily_usage_buckets": None, "source_updated_at": None,
           "cycle_tokens": None, "cycle_tokens_reason": CYCLE_REASON}
    if not isinstance(payload, dict):
        return out, ["usage_payload_invalid"]
    issues = []
    summary = payload.get("summary")
    if isinstance(summary, dict):
        out["summary"] = {}
        fields = ("lifetimeTokens", "peakDailyTokens", "longestRunningTurnSec",
                  "currentStreakDays", "longestStreakDays")
        if summary and not any(field in summary for field in fields):
            issues.append("usage_summary_fields_unknown")
        for key in fields:
            value = summary.get(key)
            out["summary"][key] = integer(value)
            if value is not None and integer(value) is None:
                issues.append("usage_summary_field_invalid")
    else:
        issues.append("usage_summary_invalid")
    daily = payload.get("dailyUsageBuckets")
    if isinstance(daily, list):
        out["daily_usage_buckets"] = []
        for row in daily:
            if not isinstance(row, dict):
                issues.append("usage_daily_bucket_invalid")
                continue
            date, tokens = row.get("startDate"), integer(row.get("tokens"))
            if not isinstance(date, str):
                date = None
            if date is None or tokens is None:
                issues.append("usage_daily_field_invalid")
            out["daily_usage_buckets"].append({"start_date": date, "tokens": tokens})
    elif daily is not None:
        issues.append("usage_daily_buckets_invalid")
    return out, list(dict.fromkeys(issues))


def snapshot():
    return {"snapshot_schema_version": "1.0", "collector_version": VERSION, "status": "error",
            "collection_started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "collected_at": None, "source": {"kind": "official_codex_cli_app_server", "codex_version": None},
            "identity": None, "queries": {"account": q(), "rate_limits": q(), "usage": q()},
            "quota_buckets": None, "token_statistics": None, "errors": []}


def validate_options(options):
    for name in ("codex", "codex_home", "target_file"):
        value = getattr(options, name)
        if value is not None and (not isinstance(value, str) or not value
                                  or "\0" in value or len(value) > 4096):
            raise E("options_invalid")
    if (not options.codex or number(options.timeout) is None
            or not 0 < options.timeout <= 120):
        raise E("options_invalid")


def collect(options):
    started, out, rpc = time.monotonic(), snapshot(), None
    try:
        validate_options(options)
        exe = shutil.which(options.codex) if os.sep not in options.codex else options.codex
        if not exe or not os.path.isfile(exe) or not os.access(exe, os.X_OK):
            raise E("codex_cli_not_found")
        target = load_target(options.target_file)
        env = os.environ.copy()
        if options.codex_home:
            env["CODEX_HOME"] = options.codex_home
        try:
            version = subprocess.run([exe, "--version"], capture_output=True, text=True,
                                     timeout=min(5, options.timeout), env=env)
            if version.returncode == 0:
                out["source"]["codex_version"] = version.stdout.strip()[:120]
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
        rpc = RPC([exe, "app-server"], env)
        rpc.call("initialize", {"clientInfo": {"name": "codex-usage", "version": VERSION},
                                "capabilities": {}}, options.timeout)
        rpc.notify("initialized", {})
        account = rpc.call(ACCOUNT, {"refreshToken": False}, options.timeout)
        out["identity"] = verify_account(account, target)
        out["queries"]["account"] = q("ok")
        for method, key in ((RATE, "rate_limits"), (USAGE, "usage")):
            try:
                value = rpc.call(method, {}, options.timeout)
                if method == RATE:
                    out["quota_buckets"], issues = normalize_rates(value, int(time.time()))
                else:
                    out["token_statistics"], issues = normalize_usage(value)
                out["queries"][key] = q("partial" if issues else "ok")
                if issues:
                    out["queries"][key]["field_issues"] = issues
            except E as error:
                out["queries"][key] = q("error", error)
        try:
            verify_account(rpc.call(ACCOUNT, {"refreshToken": False}, options.timeout), target)
        except E as error:
            out["queries"]["account"] = q("error", error)
            raise
        states = [out["queries"][key]["status"] for key in ("rate_limits", "usage")]
        out["status"] = ("ok" if states == ["ok", "ok"] else "partial"
                         if any(state in ("ok", "partial") for state in states) else "error")
    except (E, OSError, ValueError) as error:
        if not isinstance(error, E):
            error = E("process_write_failed" if isinstance(error, BrokenPipeError) else "collection_failed")
        out["errors"].append(error.public())
        out["identity"] = out["quota_buckets"] = out["token_statistics"] = None
        if out["queries"]["account"]["status"] == "not_attempted":
            out["queries"]["account"] = q("error", error)
    finally:
        if rpc:
            try:
                rpc.close()
            except (E, OSError) as error:
                out["status"] = "error"
                out["identity"] = out["quota_buckets"] = out["token_statistics"] = None
                error = error if isinstance(error, E) else E("process_cleanup_failed")
                out["errors"].append(error.public())
        out["collected_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        out["collection_duration_ms"] = round((time.monotonic() - started) * 1000, 3)
    return out


get_codex_usage_snapshot = collect


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise E("options_invalid")


def main():
    parser = Parser()
    parser.add_argument("--codex", default="codex")
    parser.add_argument("--codex-home")
    parser.add_argument("--target-file", required=True)
    parser.add_argument("--timeout", type=float, default=10.0)
    try:
        args = parser.parse_args()
        result = collect(Options(args.codex, args.codex_home, args.target_file, args.timeout))
    except E as error:
        result = snapshot()
        result["errors"].append(error.public())
        result["collected_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["status"] == "ok" else 2 if result["status"] == "partial" else 1


if __name__ == "__main__":
    raise SystemExit(main())
