"""Explicit mock-harness tool relay; never activated by the production worker.

Only broker execution uses the separate, bounded executor. No provider token is
sent to the connector. Uncertain delivery closes the channel without retries.
"""

import hmac
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from .domain import Problem
from .tool_broker.broker import canonical
from .tool_broker.policy import normalize_request

_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="tool-session")
_SLOTS = threading.BoundedSemaphore(4)
_BINDING = {"instance_id", "run_id", "binding_id", "generation"}
_RECEIPT = re.compile(r"[A-Za-z0-9_-]{43}\Z")


def uuid_text(value):
    return type(value) is str and str(UUID(value)) == value


class ToolSession:
    def __init__(self, broker, connector, *, run_id, generation, owner, binding_id):
        if type(generation) is not int or generation < 1:
            raise ValueError("tool_session_identity_invalid")
        self.broker, self.connector = broker, connector
        self.run = {
            "id": UUID(str(run_id)),
            "generation": generation,
            "sandbox_id": UUID(str(binding_id)),
        }
        self.owner = UUID(str(owner))
        self.binding = None
        self.token = None
        self.closed, self.error = False, None
        self._future, self._pending, self._receipt = None, None, None
        self._lock = threading.RLock()
        self._close_lock = threading.Lock()

    def _guard(self):
        if self.closed:
            raise Problem(409, "tool_session_closed")

    def _identity(self, value, extra=()):
        if (
            type(value) is not dict
            or set(value) != _BINDING | set(extra)
            or not uuid_text(value["instance_id"])
            or value["run_id"] != str(self.run["id"])
            or value["binding_id"] != str(self.run["sandbox_id"])
            or type(value["generation"]) is not int
            or value["generation"] != self.run["generation"]
            or (self.binding and any(value[key] != self.binding[key] for key in _BINDING))
        ):
            raise Problem(409, "tool_session_identity_invalid")

    def _poll(self):
        value = self.connector.tool(self.run, "poll")
        self._guard()
        if (
            type(value) is not dict
            or set(value) != {"instance_id", "pending", "ack"}
            or value["instance_id"] != self.binding["instance_id"]
            or (value["pending"] is not None and value["ack"] is not None)
        ):
            raise Problem(409, "tool_session_identity_invalid")
        if value["pending"] is not None:
            self._identity(value["pending"], ("operation_id", "payload"))
            if not uuid_text(value["pending"]["operation_id"]):
                raise Problem(409, "tool_session_identity_invalid")
        if value["ack"] is not None:
            self._identity(value["ack"], ("operation_id", "receipt"))
        return value["pending"], value["ack"]

    def _submit(self, pending):
        # Normalize synchronously before consuming an execution slot. A deep
        # snapshot prevents mutable relay objects from changing the admitted call.
        self._guard()
        payload = normalize_request(self.broker.policy, pending["payload"])
        self._pending = {**pending, "payload": payload}
        if not _SLOTS.acquire(blocking=False):
            raise Problem(429, "tool_session_capacity")
        try:
            future = _EXECUTOR.submit(
                self.broker.execute,
                self.run["id"],
                self.token,
                UUID(pending["operation_id"]),
                payload,
            )
        except Exception:
            _SLOTS.release()
            raise

        def finished(future):
            _SLOTS.release()
            # Never wait on the control lock in a completion callback: that
            # would keep an executor worker occupied after releasing its slot.
            if self.closed and self._future is future:
                self._future = None

        self._future = future
        future.add_done_callback(finished)

    def _step(self):
        if self.binding is None:
            token = self.broker.issue(
                self.run["id"], self.run["generation"], self.owner, self.run["sandbox_id"]
            )
            with self._close_lock:
                self._guard()
                self.token = token
            binding = self.connector.tool(self.run, "bind")
            self._guard()
            self._identity(binding)
            self.binding = binding.copy()
        self.broker.authorize(self.run["id"], self.token)
        self._guard()
        pending, ack = self._poll()
        if ack is not None:
            if (
                self._receipt is None
                or ack["operation_id"] != self._pending["operation_id"]
                or type(ack["receipt"]) is not str
                or not hmac.compare_digest(ack["receipt"], self._receipt)
            ):
                raise Problem(409, "tool_session_ack_invalid")
            self.broker.acknowledge(
                self.run["id"], self.token, UUID(ack["operation_id"]), ack["receipt"]
            )
            self._guard()
            if self.connector.tool(self.run, "ack", operation_id=ack["operation_id"]) != {
                "accepted": True
            }:
                raise Problem(409, "tool_session_ack_unknown")
            self._pending, self._receipt = None, None
            return
        if self._pending is not None:
            if pending is None or canonical(pending) != canonical(self._pending):
                raise Problem(409, "tool_session_pending_changed")
            if self._receipt is not None:
                return
            if not self._future.done():
                return
            future, self._future = self._future, None
            if future.cancelled() or future.exception() is not None:
                raise Problem(409, "tool_session_outcome_unknown")
            result = future.result()
            if (
                type(result) is not dict
                or result.get("operation_id") != pending["operation_id"]
                or result.get("status") != "succeeded"
                or result.get("delivery") != "pending"
                or "result" not in result
                or type(result.get("receipt")) is not str
                or not _RECEIPT.fullmatch(result["receipt"])
            ):
                raise Problem(409, "tool_session_outcome_unknown")
            # Recheck after waiting for provider completion and helper polling.
            self.broker.authorize(self.run["id"], self.token)
            with self._close_lock:
                self._guard()
                self._receipt = result["receipt"]
            if self.connector.tool(
                self.run,
                "deliver",
                operation_id=pending["operation_id"],
                result=result["result"],
                receipt=self._receipt,
            ) != {"accepted": True}:
                raise Problem(409, "tool_session_delivery_unknown")
            return
        if pending is not None:
            self._submit(pending)

    def step(self):
        """Advance one relay tick without waiting for an upstream execution."""
        with self._lock:
            if self.closed:
                return
            try:
                self._step()
            except Exception:
                if not self.closed:
                    self.error = "tool_session_unavailable"
                    self.close()

    def close(self):
        """Revoke first; discard eventual completion without joining its thread."""
        # Control revocation must not wait behind bind/poll/deliver network I/O
        # in step(). A resumed step checks closed before its next effect.
        with self._close_lock:
            if self.closed:
                return
            self.closed = True
            try:
                self.broker.revoke(self.run["id"])
            except Exception:
                self.error = "tool_session_revoke_unconfirmed"
            self.token, self._receipt, self._pending = None, None, None
            if self._future is not None and self._future.done():
                self._future = None
            try:
                self.connector.tool(self.run, "close")
            except Exception:
                if self.error is None:
                    self.error = "tool_session_close_unconfirmed"
