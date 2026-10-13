"""Bounded Linux observations of lifecycle-authorized process generations.

Private helpers only read numeric /proc/<pid>/stat records. They never discover
ownership, inspect command/environment data, or signal observed processes.
"""

import json
import math
import os
from pathlib import Path
import selectors
import subprocess
import sys
import threading
import time

PHASE_NAMES = ("source_idle", "source_read_probe", "restarted_idle", "restarted_read_probe")
REASONS = frozenset(("identity_error", "identity_limit", "stat_error", "counter_regression",
                     "protocol_error", "helper_timeout", "helper_cleanup", "sample_limit",
                     "phase_timeout", "probe_failed", "insufficient_samples"))
INTERVAL_SECONDS = .25
IDENTITY_LIMIT = 512
STAT_LIMIT = 4096
PROTOCOL_LIMIT = 64 * 1024
ACQUISITION_SECONDS = 1.0
SAMPLE_LIMIT = 64
PHASE_LIMIT = 8
EXTENSION_LIMIT = 48 * 1024
TERM_SECONDS = .5
KILL_SECONDS = 1.0
JOIN_SECONDS = 3.0
LIMITS = {"interval_seconds": INTERVAL_SECONDS, "identities_per_sample": IDENTITY_LIMIT,
          "stat_bytes": STAT_LIMIT, "protocol_bytes": PROTOCOL_LIMIT,
          "helper_acquisition_seconds": ACQUISITION_SECONDS, "samples_per_phase": SAMPLE_LIMIT,
          "phase_summaries": PHASE_LIMIT, "extension_bytes": EXTENSION_LIMIT,
          "helper_terminate_seconds": TERM_SECONDS, "helper_kill_seconds": KILL_SECONDS,
          "observer_join_seconds": JOIN_SECONDS}
LIMITATIONS = {"scope": "observed_descendants", "non_atomic_scan": True,
               "full_tree_coverage": "unknown", "between_sample_coverage": "unknown",
               "short_lived_processes_may_be_missed": True, "rss": "approximate_shared_pages",
               "observer_helper_overhead": True,
               "excluded": ["harness", "sibling_cli_helpers", "cold_backup", "startup", "shutdown", "resume"]}
COUNT_FIELDS = ("samples_attempted", "samples_valid", "scheduled_slots", "skipped_slots",
                "cpu_pairs_observed", "peak_live_process_count", "missing_observations",
                "reused_observations", "zombie_observations", "cpu_unpaired_observations",
                "probe_attempted", "probe_completed")
DURATION_FIELDS = ("elapsed_seconds", "max_sample_gap_seconds", "max_scan_seconds")
METRIC_FIELDS = ("peak_sampled_rss_bytes", "observed_cpu_ticks", "observed_cpu_seconds")
PHASE_FIELDS = frozenset(("phase", "status", "reason") + COUNT_FIELDS + DURATION_FIELDS + METRIC_FIELDS)
RECORD_FIELDS = frozenset(("pid", "start_ticks", "status", "rss_pages", "cpu_ticks"))


class ResourceError(Exception):
    """Fixed public reason and an optional strictly projected partial summary."""
    def __init__(self, reason, summary=None):
        self.reason = reason if type(reason) is str and reason in REASONS else "protocol_error"
        self.summary = self.partial_summary = project_phase(summary) if summary is not None else None
        super().__init__(self.reason)


def _integer(value, minimum=0):
    return type(value) is int and value >= minimum


def _number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def resource_units():
    try:
        units = {"page_size_bytes": os.sysconf("SC_PAGE_SIZE"),
                 "clock_ticks_per_second": os.sysconf("SC_CLK_TCK")}
    except (OSError, ValueError):
        raise ResourceError("stat_error") from None
    if not all(_integer(v, 1) for v in units.values()):
        raise ResourceError("stat_error")
    return units


def normalize_identities(value):
    """Copy only the two authorized numeric fields, retaining root-first order."""
    if type(value) not in (list, tuple) or not value:
        raise ResourceError("identity_error")
    if len(value) > IDENTITY_LIMIT:
        raise ResourceError("identity_limit")
    copied, seen = [], set()
    for item in value:
        if type(item) is not dict:
            raise ResourceError("identity_error")
        pid, start = item.get("pid"), item.get("start_ticks")
        if not _integer(pid, 1) or not _integer(start):
            raise ResourceError("identity_error")
        if (pid, start) in seen:
            raise ResourceError("identity_error")
        seen.add((pid, start))
        copied.append({"pid": pid, "start_ticks": start})
    return copied


def parse_stat(value):
    """Parse own CPU and resident pages, tolerating ')' in the discarded comm."""
    try:
        if type(value) is bytes:
            if len(value) > STAT_LIMIT:
                raise ValueError
            # comm is discarded and can contain arbitrary non-ASCII bytes.
            value = value.decode("latin-1")
        elif type(value) is not str or len(value.encode("utf-8")) > STAT_LIMIT:
            raise ValueError
        left, right = value.find(" ("), value.rfind(") ")
        if left < 1 or right <= left:
            raise ValueError
        pid_text = value[:left]
        if not pid_text.isascii() or not pid_text.isdecimal():
            raise ValueError
        fields = value[right + 2:].split()
        if len(fields) < 22 or len(fields[0]) != 1 or fields[0] not in "RSDZTtWXxKIP":
            raise ValueError
        values = []
        for index in (11, 12, 19, 21):
            if not fields[index].isascii() or not fields[index].isdecimal():
                raise ValueError
            values.append(int(fields[index]))
        pid = int(pid_text)
        if pid <= 0:
            raise ValueError
        return {"pid": pid, "start_ticks": values[2],
                "status": "zombie" if fields[0] in "ZXx" else "live",
                "rss_pages": values[3], "cpu_ticks": values[0] + values[1]}
    except (ValueError, UnicodeError, OverflowError):
        raise ResourceError("stat_error") from None


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _json(value):
    try:
        if type(value) not in (bytes, str) or len(value if type(value) is bytes else value.encode("utf-8")) > PROTOCOL_LIMIT:
            raise ValueError
        return json.loads(value, object_pairs_hook=_pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        raise ResourceError("protocol_error") from None


def parse_request(value):
    obj = _json(value)
    if type(obj) is not dict or set(obj) != {"identities"}:
        raise ResourceError("protocol_error")
    items = obj["identities"]
    if type(items) is not list or any(type(i) is not dict or set(i) != {"pid", "start_ticks"} for i in items):
        raise ResourceError("protocol_error")
    try:
        return normalize_identities(items)
    except ResourceError:
        raise ResourceError("protocol_error") from None


def parse_reply(value, identities):
    requested = normalize_identities(identities)
    obj = _json(value)
    if type(obj) is not dict or set(obj) != {"records"} or type(obj["records"]) is not list:
        raise ResourceError("protocol_error")
    expected = {(i["pid"], i["start_ticks"]) for i in requested}
    found = {}
    for rec in obj["records"]:
        if type(rec) is not dict or set(rec) != RECORD_FIELDS:
            raise ResourceError("protocol_error")
        pid, start, status = rec["pid"], rec["start_ticks"], rec["status"]
        if not _integer(pid, 1) or not _integer(start) or type(status) is not str or status not in ("live", "zombie", "missing", "reused"):
            raise ResourceError("protocol_error")
        identity = pid, start
        if identity not in expected or identity in found:
            raise ResourceError("protocol_error")
        metrics = (rec["rss_pages"], rec["cpu_ticks"])
        if status in ("missing", "reused"):
            if metrics != (None, None):
                raise ResourceError("protocol_error")
        elif not all(_integer(v) for v in metrics):
            raise ResourceError("protocol_error")
        found[identity] = dict(rec)
    if set(found) != expected:
        raise ResourceError("protocol_error")
    return [found[(i["pid"], i["start_ticks"])] for i in requested]


def _read_records(identities):
    records = []
    for identity in identities:
        pid, start = identity["pid"], identity["start_ticks"]
        try:
            with open(f"/proc/{pid}/stat", "rb") as stream:
                rec = parse_stat(stream.read(STAT_LIMIT + 1))
        except FileNotFoundError:
            rec = dict(identity, status="missing", rss_pages=None, cpu_ticks=None)
        except OSError:
            raise ResourceError("stat_error") from None
        else:
            if rec["pid"] != pid:
                raise ResourceError("stat_error")
            if rec["start_ticks"] != start:
                rec = dict(identity, status="reused", rss_pages=None, cpu_ticks=None)
        records.append(rec)
    return records


def _helper_main():
    try:
        identities = parse_request(sys.stdin.buffer.read(PROTOCOL_LIMIT + 1))
        payload = json.dumps({"records": _read_records(identities)}, allow_nan=False,
                             separators=(",", ":")).encode("ascii")
        if len(payload) > PROTOCOL_LIMIT:
            raise ResourceError("protocol_error")
        sys.stdout.buffer.write(payload)
        sys.stdout.buffer.flush()
        return 0
    except ResourceError as exc:
        return 2 if exc.reason == "stat_error" else 3
    except Exception:
        return 3


def _spawn_helper():
    # Fixed trusted argv; no observed argv, commands, paths or credentials pass in.
    return subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--helper"],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, close_fds=True)


def _close_helper(child):
    """Signal only our acquisition helper and verify reap within finite waits."""
    try:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=TERM_SECONDS)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=KILL_SECONDS)
        else:
            child.wait(timeout=0)
        if child.poll() is None:
            raise ResourceError("helper_cleanup")
    except (OSError, subprocess.TimeoutExpired):
        raise ResourceError("helper_cleanup") from None
    finally:
        for stream in (child.stdin, child.stdout):
            if stream is not None:
                stream.close()


def acquire_sample(identities, deadline):
    """Exchange a bounded numeric message with deadline-bounded read AND write."""
    identities = normalize_identities(identities)
    if not _number(deadline):
        raise ResourceError("protocol_error")
    end = min(deadline, time.monotonic() + ACQUISITION_SECONDS)
    if end <= time.monotonic():
        raise ResourceError("phase_timeout")
    payload = json.dumps({"identities": identities}, separators=(",", ":"), allow_nan=False).encode("ascii")
    if len(payload) > PROTOCOL_LIMIT:
        raise ResourceError("protocol_error")
    try:
        child = _spawn_helper()
    except OSError:
        raise ResourceError("protocol_error") from None
    failure, result = None, None
    try:
        with selectors.DefaultSelector() as selector:
            os.set_blocking(child.stdin.fileno(), False)
            os.set_blocking(child.stdout.fileno(), False)
            selector.register(child.stdin, selectors.EVENT_WRITE, "write")
            selector.register(child.stdout, selectors.EVENT_READ, "read")
            written, reply, eof = 0, bytearray(), False
            while not eof:
                remaining = end - time.monotonic()
                if remaining <= 0:
                    raise ResourceError("helper_timeout")
                for key, _ in selector.select(remaining):
                    if key.data == "write":
                        try:
                            written += os.write(key.fd, payload[written:])
                        except BlockingIOError:
                            continue
                        if written == len(payload):
                            selector.unregister(child.stdin)
                            child.stdin.close()
                    else:
                        try:
                            chunk = os.read(key.fd, min(8192, PROTOCOL_LIMIT + 1 - len(reply)))
                        except BlockingIOError:
                            continue
                        if not chunk:
                            eof = True
                            selector.unregister(child.stdout)
                        else:
                            reply.extend(chunk)
                            if len(reply) > PROTOCOL_LIMIT:
                                raise ResourceError("protocol_error")
            try:
                code = child.wait(timeout=max(0, end - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise ResourceError("helper_timeout") from None
            if time.monotonic() > end:
                raise ResourceError("helper_timeout")
            if code != 0:
                raise ResourceError("stat_error" if code == 2 else "protocol_error")
            result = parse_reply(bytes(reply), identities)
    except ResourceError as exc:
        failure = exc.reason
    except (OSError, ValueError):
        failure = "protocol_error"
    finally:
        try:
            _close_helper(child)
        except ResourceError:
            failure = "helper_cleanup"
    if failure:
        raise ResourceError(failure)
    return result


def project_phase(value):
    if type(value) is not dict or set(value) != PHASE_FIELDS:
        raise ResourceError("protocol_error")
    if type(value["phase"]) is not str or type(value["status"]) is not str or value["phase"] not in PHASE_NAMES or value["status"] not in ("observed", "failed", "insufficient_samples"):
        raise ResourceError("protocol_error")
    if value["reason"] is not None and (type(value["reason"]) is not str or value["reason"] not in REASONS):
        raise ResourceError("protocol_error")
    if (value["status"] == "observed") != (value["reason"] is None):
        raise ResourceError("protocol_error")
    if (value["status"] == "insufficient_samples") != (value["reason"] == "insufficient_samples"):
        raise ResourceError("protocol_error")
    if not all(_integer(value[k]) for k in COUNT_FIELDS) or not all(_number(value[k]) for k in DURATION_FIELDS):
        raise ResourceError("protocol_error")
    for key in METRIC_FIELDS:
        metric = value[key]
        if metric is not None and not (_number(metric) if key == "observed_cpu_seconds" else _integer(metric)):
            raise ResourceError("protocol_error")
    attempted, valid, slots = value["samples_attempted"], value["samples_valid"], value["scheduled_slots"]
    if not (valid <= attempted <= slots and attempted <= SAMPLE_LIMIT) or value["skipped_slots"] != slots - attempted:
        raise ResourceError("protocol_error")
    if not (value["probe_completed"] <= value["probe_attempted"] <= 8) or value["peak_live_process_count"] > IDENTITY_LIMIT:
        raise ResourceError("protocol_error")
    if value["cpu_pairs_observed"] > max(0, valid - 1) * IDENTITY_LIMIT or value["cpu_unpaired_observations"] > valid * IDENTITY_LIMIT:
        raise ResourceError("protocol_error")
    if any(value[k] > attempted * IDENTITY_LIMIT for k in ("missing_observations", "reused_observations", "zombie_observations")):
        raise ResourceError("protocol_error")
    if (value["peak_sampled_rss_bytes"] is None) != (valid == 0) or (value["peak_live_process_count"] == 0) != (valid == 0):
        raise ResourceError("protocol_error")
    paired = value["cpu_pairs_observed"] > 0
    if paired != (value["observed_cpu_ticks"] is not None) or paired != (value["observed_cpu_seconds"] is not None):
        raise ResourceError("protocol_error")
    if value["status"] == "observed":
        required_probes = 8 if value["phase"].endswith("read_probe") else 0
        if valid != attempted or slots > SAMPLE_LIMIT or valid < 2 or not paired or value["probe_attempted"] != required_probes or value["probe_completed"] != required_probes:
            raise ResourceError("protocol_error")
        # Every valid scan contains the live original root. Every record is
        # exactly one paired or unpaired observation; the first root scan
        # establishes a baseline rather than creating a CPU pair.
        observations = value["cpu_pairs_observed"] + value["cpu_unpaired_observations"]
        non_live = sum(value[k] for k in ("missing_observations", "reused_observations", "zombie_observations"))
        if not (valid <= observations <= valid * IDENTITY_LIMIT) or value["cpu_unpaired_observations"] < 1 or non_live > valid * (IDENTITY_LIMIT - 1):
            raise ResourceError("protocol_error")
    return dict(value)


def project_resources(value):
    if type(value) is not dict or set(value) != {"schema_version", "units", "limits", "limitations", "phases"}:
        raise ResourceError("protocol_error")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise ResourceError("protocol_error")
    units = value["units"]
    if type(units) is not dict or set(units) != {"page_size_bytes", "clock_ticks_per_second"} or not all(_integer(v, 1) for v in units.values()):
        raise ResourceError("protocol_error")
    # Serialized comparison also rejects bool-for-int equivalence and extra keys.
    for key, expected in (("limits", LIMITS), ("limitations", LIMITATIONS)):
        try:
            if json.dumps(value[key], sort_keys=True, allow_nan=False) != json.dumps(expected, sort_keys=True):
                raise ResourceError("protocol_error")
        except (ValueError, TypeError, RecursionError):
            raise ResourceError("protocol_error") from None
    phases = value["phases"]
    if type(phases) is not dict or set(phases) != set(PHASE_NAMES):
        raise ResourceError("protocol_error")
    projected = {name: project_phase(phases[name]) for name in PHASE_NAMES}
    if any(projected[name]["phase"] != name for name in PHASE_NAMES):
        raise ResourceError("protocol_error")
    for phase in projected.values():
        if phase["observed_cpu_ticks"] is not None:
            try:
                seconds = phase["observed_cpu_ticks"] / units["clock_ticks_per_second"]
            except OverflowError:
                raise ResourceError("protocol_error") from None
            if not _number(seconds) or phase["observed_cpu_seconds"] != seconds:
                raise ResourceError("protocol_error")
    result = {"schema_version": 1, "units": dict(units),
              "limits": dict(LIMITS), "limitations": json.loads(json.dumps(LIMITATIONS)),
              "phases": projected}
    if len(json.dumps(result, indent=2, sort_keys=True, allow_nan=False).encode("utf-8")) > EXTENSION_LIMIT:
        raise ResourceError("protocol_error")
    return result


def resources_extension(phases):
    return project_resources({"schema_version": 1, "units": resource_units(),
                              "limits": LIMITS, "limitations": LIMITATIONS, "phases": phases})


class PhaseAccumulator:
    """Pure scan reducer: aggregate RSS peaks and consecutive own-CPU pairs."""
    def __init__(self, name, units):
        if name not in PHASE_NAMES:
            raise ResourceError("protocol_error")
        if type(units) is not dict or set(units) != {"page_size_bytes", "clock_ticks_per_second"} or not all(_integer(v, 1) for v in units.values()):
            raise ResourceError("stat_error")
        self.name, self.units = name, dict(units)
        self.counts = dict.fromkeys(COUNT_FIELDS, 0)
        self.previous, self.last_offset = {}, None
        self.seen_cpu = {}
        self.root = None
        self.peak, self.ticks = None, 0
        self.max_gap, self.max_scan = 0.0, 0.0

    def add_sample(self, records, offset, scan_seconds):
        identities = [{"pid": r.get("pid"), "start_ticks": r.get("start_ticks")} for r in records]
        records = parse_reply(json.dumps({"records": records}, allow_nan=False).encode(), identities)
        if not _number(offset) or not _number(scan_seconds) or (self.last_offset is not None and offset < self.last_offset):
            raise ResourceError("protocol_error")
        root = records[0]["pid"], records[0]["start_ticks"]
        if self.root is not None and root != self.root:
            raise ResourceError("identity_error")
        gap = 0 if self.last_offset is None else offset - self.last_offset
        previous = {} if gap > .5 else self.previous
        live, rss, delta, pairs, unpaired = 0, 0, 0, 0, 0
        current, observations = {}, {"missing": 0, "reused": 0, "zombie": 0}
        for rec in records:
            identity = rec["pid"], rec["start_ticks"]
            status = rec["status"]
            if status != "live":
                observations[status] += 1
            if status in ("missing", "reused"):
                unpaired += 1
                continue
            if status == "live":
                live += 1
                rss += rec["rss_pages"] * self.units["page_size_bytes"]
            ticks = rec["cpu_ticks"]
            if identity in self.seen_cpu and ticks < self.seen_cpu[identity]:
                raise ResourceError("counter_regression")
            if identity in previous:
                if ticks < previous[identity]:
                    raise ResourceError("counter_regression")
                delta += ticks - previous[identity]
                pairs += 1
            else:
                unpaired += 1
            current[identity] = ticks
        # Root absence is recorded explicitly but this scan cannot provide valid metrics.
        if records[0]["status"] != "live":
            for status, count in observations.items():
                self.counts[status + "_observations"] += count
            raise ResourceError("identity_error")
        try:
            finite_cpu = _number((self.ticks + delta) / self.units["clock_ticks_per_second"])
        except OverflowError:
            finite_cpu = False
        if not finite_cpu:
            raise ResourceError("stat_error")
        self.root = root
        self.last_offset, self.previous = offset, current
        self.seen_cpu.update(current)
        self.max_gap, self.max_scan = max(self.max_gap, gap), max(self.max_scan, scan_seconds)
        self.peak = rss if self.peak is None else max(self.peak, rss)
        self.ticks += delta
        self.counts["samples_valid"] += 1
        self.counts["cpu_pairs_observed"] += pairs
        self.counts["cpu_unpaired_observations"] += unpaired
        self.counts["peak_live_process_count"] = max(self.counts["peak_live_process_count"], live)
        for status, count in observations.items():
            self.counts[status + "_observations"] += count

    def summary(self, elapsed_seconds, reason=None):
        if reason is None and (self.counts["samples_valid"] < 2 or self.counts["cpu_pairs_observed"] < 1):
            reason = "insufficient_samples"
        status = "observed" if reason is None else ("insufficient_samples" if reason == "insufficient_samples" else "failed")
        ticks = self.ticks if self.counts["cpu_pairs_observed"] else None
        try:
            seconds = None if ticks is None else ticks / self.units["clock_ticks_per_second"]
        except OverflowError:
            raise ResourceError("stat_error") from None
        if seconds is not None and not _number(seconds):
            raise ResourceError("stat_error")
        return project_phase(dict(self.counts, phase=self.name, status=status, reason=reason,
                                  elapsed_seconds=elapsed_seconds, max_sample_gap_seconds=self.max_gap,
                                  max_scan_seconds=self.max_scan, peak_sampled_rss_bytes=self.peak,
                                  observed_cpu_ticks=ticks,
                                  observed_cpu_seconds=seconds))


def observe_phase(name, identities, *, duration_seconds, probe=None, probe_count=0):
    """Observe concurrently with caller-thread serial probes within one deadline.

    Probe is a trusted harness callback honoring the supplied absolute deadline.
    Only helper/thread closure receives its separate finite close budget.
    """
    acc = PhaseAccumulator(name, resource_units())
    if not _number(duration_seconds) or duration_seconds <= 0 or not callable(identities) or not _integer(probe_count) or (probe_count and not callable(probe)):
        raise ResourceError("protocol_error", acc.summary(0, "protocol_error"))
    if not _number(duration_seconds / INTERVAL_SECONDS):
        raise ResourceError("sample_limit", acc.summary(0, "sample_limit"))
    started = time.monotonic()
    deadline = started + duration_seconds
    acc.counts["scheduled_slots"] = math.ceil(duration_seconds / INTERVAL_SECONDS)
    stop = threading.Event()
    errors = []
    lock = threading.Lock()

    def observer():
        slot = 0
        try:
            while slot < acc.counts["scheduled_slots"] and not stop.is_set():
                target = started + slot * INTERVAL_SECONDS
                if stop.wait(max(0, target - time.monotonic())):
                    break
                now = time.monotonic()
                if now >= deadline:
                    break
                # Overdue slots are explicit gaps, never a burst of fabricated scans.
                due = min(acc.counts["scheduled_slots"] - 1, int((now - started) / INTERVAL_SECONDS))
                slot = max(slot, due)
                with lock:
                    if acc.counts["samples_attempted"] >= SAMPLE_LIMIT:
                        raise ResourceError("sample_limit")
                    acc.counts["samples_attempted"] += 1
                scan_started = time.monotonic()
                try:
                    try:
                        copied = normalize_identities(identities())
                    except ResourceError:
                        raise
                    except Exception:
                        raise ResourceError("identity_error") from None
                    records = acquire_sample(copied, deadline)
                finally:
                    ended = time.monotonic()
                    with lock:
                        acc.max_scan = max(acc.max_scan, ended - scan_started)
                if ended >= deadline:
                    raise ResourceError("phase_timeout")
                with lock:
                    acc.add_sample(records, scan_started - started, ended - scan_started)
                slot += 1
        except ResourceError as exc:
            errors.append(exc.reason)
            stop.set()
        except Exception:
            errors.append("protocol_error")
            stop.set()

    thread = threading.Thread(target=observer, name="resource-observer", daemon=True)
    thread.start()
    failure = None
    try:
        last_start = None
        for index in range(probe_count):
            target = started + index * .5
            if last_start is not None:
                target = max(target, last_start + .5)
            if stop.wait(max(0, min(target, deadline) - time.monotonic())):
                break
            if time.monotonic() >= deadline:
                failure = "phase_timeout"
                break
            last_start = time.monotonic()
            with lock:
                acc.counts["probe_attempted"] += 1
            try:
                probe(deadline)
            except Exception:
                failure = "probe_failed"
                break
            if time.monotonic() >= deadline:
                failure = "phase_timeout"
                break
            with lock:
                acc.counts["probe_completed"] += 1
        if failure is None:
            stop.wait(max(0, deadline - time.monotonic()))
        phase_ended = time.monotonic()
    finally:
        stop.set()
        thread.join(timeout=JOIN_SECONDS)
    if thread.is_alive():
        failure = "helper_cleanup"
    elif errors:
        failure = errors[0]
    if failure is None and acc.counts["probe_completed"] != probe_count:
        failure = "probe_failed"
    with lock:
        acc.counts["skipped_slots"] = max(0, acc.counts["scheduled_slots"] - acc.counts["samples_attempted"])
        summary = acc.summary(max(0, phase_ended - started), failure)
    if summary["reason"] is not None:
        raise ResourceError(summary["reason"], summary)
    return summary


if __name__ == "__main__":
    # This entry point intentionally accepts no arbitrary path/command argument.
    sys.exit(_helper_main() if sys.argv[1:] == ["--helper"] else 3)
