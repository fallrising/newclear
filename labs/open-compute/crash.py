"""Strict receipts for sequential SIGKILL of lifecycle-authorized generations.

This helper never discovers ownership, starts processes, or authorizes deletion.
Only a verified receipt can be considered by the caller for restart authority.
"""

import copy
import json
import math
import os
import signal
import time

LIMITS = {"max_targets": 64, "shutdown_seconds": 10, "extension_bytes": 49152}
LIMITATIONS = {"same_runner": True, "same_path": True, "same_uid": True,
              "public_committed_wait": True, "sequential_signals": True,
              "kernel_filesystem_alive": True, "observed_generations_only": True,
              "unobserved_descendants": "unknown", "power_loss_tested": False,
              "in_flight_step_tested": False, "external_exactly_once_tested": False}
REASONS = frozenset(("ownership", "identity", "signal", "deadline", "survivor", "observer", "schema"))
READBACK_FLAGS = ("instance_account_database_unchanged", "state_identity_unchanged",
                 "d1_row_unchanged", "original_workflow_waiting", "read_only_http_enforced")
CRASH_FIELDS = frozenset(("schema_version", "status", "reason", "signal", "limits", "limitations",
                          "targets", "attempted", "signaled", "root_exit_code", "all_owned_exited",
                          "observers_closed", "elapsed_seconds"))
TARGET_FIELDS = frozenset(("pid", "pgid", "start_ticks", "signal_sent", "exit_observed"))


def initial_crash():
    return {"schema_version": 1, "status": "not_run", "reason": None, "signal": "SIGKILL",
            "limits": copy.deepcopy(LIMITS), "limitations": copy.deepcopy(LIMITATIONS),
            "targets": [], "attempted": 0, "signaled": 0, "root_exit_code": None,
            "all_owned_exited": False, "observers_closed": False, "elapsed_seconds": 0}


class CrashError(RuntimeError):
    """Public errors contain only a fixed reason and a validated partial receipt."""

    def __init__(self, reason, receipt=None):
        self.reason = reason if type(reason) is str and reason in REASONS else "schema"
        if receipt is None:
            receipt = initial_crash()
            receipt.update(status="failed", reason=self.reason)
        else:
            try:
                receipt = project_crash(receipt)
                _require(receipt["status"] == "failed" and receipt["reason"] == self.reason)
            except CrashError:
                self.reason = "schema"
                receipt = initial_crash()
                receipt.update(status="failed", reason=self.reason)
        self.receipt = receipt
        super().__init__(self.reason)


def _require(condition):
    if not condition:
        raise CrashError("schema")


def _integer(value, minimum=0):
    return type(value) is int and value >= minimum


def _number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def _exact_fixed(value, expected):
    return (type(value) is dict and set(value) == set(expected) and
            all(type(value[key]) is type(item) and value[key] == item for key, item in expected.items()))


def project_crash(value):
    """Rebuild exact numeric/enum observations; reject fabricated verification."""
    _require(type(value) is dict and set(value) == CRASH_FIELDS)
    _require(type(value["schema_version"]) is int and value["schema_version"] == 1)
    _require(type(value["status"]) is str and value["status"] in {"not_run", "failed", "verified"})
    _require(type(value["signal"]) is str and value["signal"] == "SIGKILL")
    _require(_exact_fixed(value["limits"], LIMITS) and _exact_fixed(value["limitations"], LIMITATIONS))
    _require(type(value["targets"]) is list and len(value["targets"]) <= LIMITS["max_targets"])
    targets = []
    seen = set()
    for item in value["targets"]:
        _require(type(item) is dict and set(item) == TARGET_FIELDS)
        _require(_integer(item["pid"], 1) and _integer(item["pgid"], 1) and _integer(item["start_ticks"]))
        _require(type(item["signal_sent"]) is bool and type(item["exit_observed"]) is bool)
        _require(item["pid"] not in seen)
        seen.add(item["pid"])
        targets.append({key: item[key] for key in TARGET_FIELDS})
    # The actual root is bound to owner.identity by abrupt_shutdown and by the
    # caller's daemon_before check. Projection alone cannot infer its identity.
    _require(targets[1:] == sorted(targets[1:], key=lambda x: (x["pid"], x["start_ticks"])))
    _require(_integer(value["attempted"]) and _integer(value["signaled"]))
    attempted, signaled = value["attempted"], value["signaled"]
    _require(signaled <= attempted <= len(targets))
    _require([item["signal_sent"] for item in targets] == [True]*signaled + [False]*(len(targets)-signaled))
    # Sequential operation stops at its first unsuccessful signal attempt.
    _require(attempted <= signaled + 1)
    _require(value["root_exit_code"] is None or type(value["root_exit_code"]) is int)
    _require(type(value["all_owned_exited"]) is bool and type(value["observers_closed"]) is bool)
    _require(not value["all_owned_exited"] or all(item["exit_observed"] for item in targets))
    _require(_number(value["elapsed_seconds"]))
    status = value["status"]
    if status == "not_run":
        _require(value["reason"] is None and not targets and attempted == signaled == 0 and
                 value["elapsed_seconds"] == 0 and value["root_exit_code"] is None and
                 not value["all_owned_exited"] and not value["observers_closed"])
    elif status == "verified":
        _require(value["reason"] is None and len(targets) >= 2 and attempted == signaled == len(targets) and
                 all(item["exit_observed"] for item in targets) and value["root_exit_code"] == -9 and
                 value["all_owned_exited"] and value["observers_closed"] and value["elapsed_seconds"] <= 10)
    else:
        _require(type(value["reason"]) is str and value["reason"] in REASONS)
    result = {key: copy.deepcopy(value[key]) for key in CRASH_FIELDS}
    result["targets"] = targets
    try:
        encoded = json.dumps(result, indent=2, sort_keys=True, allow_nan=False).encode()
    except (ValueError, TypeError, OverflowError):
        raise CrashError("schema") from None
    _require(len(encoded) <= LIMITS["extension_bytes"])
    return result


def initial_readback():
    return dict.fromkeys(READBACK_FLAGS, False) | {"read_requests": 0}


def project_readback(value, *, complete=False):
    _require(type(complete) is bool)
    _require(type(value) is dict and set(value) == set(READBACK_FLAGS) | {"read_requests"})
    _require(all(type(value[key]) is bool for key in READBACK_FLAGS))
    _require(_integer(value["read_requests"]) and value["read_requests"] <= 256)
    if complete:
        _require(all(value[key] for key in READBACK_FLAGS) and value["read_requests"] >= 6)
    return {key: value[key] for key in (*READBACK_FLAGS, "read_requests")}


def abrupt_shutdown(owner, *, deadline, read_identity):
    """Kill a frozen root-first target set; verify retained history and drains.

    The caller installs its main-thread deadline watchdog. This helper checks
    the same absolute deadline before/after every boundary and never signals
    by group or adopts a replacement generation.
    """
    started = time.monotonic()
    receipt = initial_crash()
    phase = "ownership"
    cutoff = started + LIMITS["shutdown_seconds"]

    def check_deadline():
        if time.monotonic() >= cutoff:
            raise CrashError("deadline")

    def generation(item):
        if (type(item) is not dict or not _integer(item.get("pid"), 1) or
                not _integer(item.get("start_ticks"))):
            raise CrashError("identity")
        return item["pid"], item["start_ticks"]

    def observe_targets():
        for target in receipt["targets"]:
            current = read_identity(target["pid"])
            if current is not None:
                generation(current)
                if type(current.get("state")) is not str or len(current["state"]) != 1:
                    raise CrashError("identity")
            target["exit_observed"] = (current is None or current["start_ticks"] != target["start_ticks"] or
                                       current["state"] == "Z")

    try:
        if not _number(deadline):
            raise CrashError("deadline")
        cutoff = min(cutoff, deadline)
        check_deadline()
        owner.snapshot()
        check_deadline()
        if owner.observation_error:
            raise CrashError("ownership")
        root = generation(owner.identity)
        retained = owner.observed_identities()
        if type(retained) is not list or len(retained) > 1024:
            raise CrashError("ownership")
        authorized = {generation(item) for item in retained}
        if len(authorized) != len(retained) or root not in authorized:
            raise CrashError("ownership")
        live = owner.live()
        check_deadline()
        if type(live) is not list or not 2 <= len(live) <= LIMITS["max_targets"]:
            raise CrashError("ownership")
        keys = [generation(item) for item in live]
        if len(set(keys)) != len(keys) or len({key[0] for key in keys}) != len(keys) or root not in keys:
            raise CrashError("ownership")
        if not set(keys) <= authorized:
            raise CrashError("ownership")
        frozen = sorted(live, key=lambda item: (generation(item) != root, *generation(item)))
        for item in frozen:
            if not _integer(item.get("pgid"), 1):
                raise CrashError("identity")
            receipt["targets"].append({"pid": item["pid"], "pgid": item["pgid"],
                                        "start_ticks": item["start_ticks"],
                                        "signal_sent": False, "exit_observed": False})
        if generation(receipt["targets"][0]) != root:
            raise CrashError("ownership")
        for target in receipt["targets"]:
            phase = "identity"
            check_deadline()
            if owner.observation_error:
                raise CrashError("ownership")
            current = read_identity(target["pid"])
            check_deadline()
            if (current is None or generation(current) != generation(target) or
                    type(current.get("state")) is not str or len(current["state"]) != 1 or
                    current["state"] == "Z"):
                raise CrashError("identity")
            phase = "signal"
            receipt["attempted"] += 1
            os.kill(target["pid"], signal.SIGKILL)
            target["signal_sent"] = True
            receipt["signaled"] += 1
        phase = "survivor"
        while True:
            check_deadline()
            receipt["root_exit_code"] = owner.process.poll()
            observe_targets()
            remaining = owner.live()
            if owner.observation_error:
                raise CrashError("ownership")
            check_deadline()
            receipt["all_owned_exited"] = (not remaining and
                                            all(item["exit_observed"] for item in receipt["targets"]))
            # /proc may show the child nonlive after this iteration's poll
            # returned None. Keep polling within the same deadline until Popen
            # actually reaps the root; nonlive observations cannot supply -9.
            if receipt["all_owned_exited"] and receipt["root_exit_code"] is not None:
                break
            time.sleep(min(.01, max(0, cutoff-time.monotonic())))
        if receipt["root_exit_code"] != -signal.SIGKILL:
            raise CrashError("identity")
        phase = "observer"
        check_deadline()
        owner.finish_threads()
        if owner.observation_error or owner.reader.is_alive() or owner.monitor.is_alive():
            raise CrashError("observer")
        receipt["observers_closed"] = True
        check_deadline()
        # A final retained-history observation cannot be replaced by target flags.
        if owner.live() or owner.observation_error:
            receipt["all_owned_exited"] = False
            raise CrashError("survivor")
        receipt.update(status="verified", elapsed_seconds=time.monotonic()-started)
        return project_crash(receipt)
    except Exception as exc:
        # The caller's one-shot watchdog may already have fired. Never begin
        # another identity read, reap, or observer operation here, even to enrich
        # diagnostics. Preserve only facts cached by completed earlier operations.
        reason = ("deadline" if time.monotonic() >= cutoff else
                  (exc.reason if isinstance(exc, CrashError) else phase))
        receipt.update(status="failed", reason=reason, elapsed_seconds=time.monotonic()-started)
        try:
            valid = project_crash(receipt)
        except CrashError:
            valid = initial_crash()
            reason = "schema"
            valid.update(status="failed", reason=reason)
        # Include all bounded local failure handling, rather than measuring
        # before handling and then silently extending the recorded duration.
        valid["elapsed_seconds"] = time.monotonic()-started
        raise CrashError(reason, valid) from None
