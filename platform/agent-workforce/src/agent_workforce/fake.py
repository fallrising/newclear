"""In-process backend double. No network, subprocess, or model call."""


class FakeBackend:
    """Controllable start, inspect, stop, and finish for one offline controller."""

    def __init__(self, mode="running", inspect_available=True, stop_proven=True):
        if mode not in ("running", "complete", "accept_then_raise"):
            raise ValueError("unsupported fake mode")
        self.mode = mode
        self.inspect_available = inspect_available
        self.stop_proven = stop_proven
        self.before_start = None
        self.starts = []
        self.inspections = []
        self.stops = []
        self._operations = {}

    def start(self, operation_id, **context):
        """Accept ``operation_id`` and optional synthetic context from the controller."""
        self._remember(operation_id)
        self.starts.append(operation_id)
        self._operations[operation_id]["context"] = dict(context)
        if self.before_start is not None:
            self.before_start(operation_id)
        if self.mode == "accept_then_raise":
            raise RuntimeError("synthetic lost acknowledgement")
        operation = self._operations[operation_id]
        if self.mode == "running":
            operation["status"] = "running"
        else:
            operation["status"] = "complete"
            operation["stopped"] = True
            operation["effects_resolved"] = True
            if operation["result"] is None:
                operation["result"] = {"synthetic": True}
        return self._receipt(operation_id)

    def inspect(self, operation_id):
        """Return the original operation, or no proof when inspection is unavailable."""
        self.inspections.append(operation_id)
        if not self.inspect_available or operation_id not in self._operations:
            return self._unknown(operation_id)
        return self._receipt(operation_id)

    def stop(self, operation_id):
        """Stop one known operation, or return a non-proof when stop is not proven."""
        self.stops.append(operation_id)
        operation = self._operations.get(operation_id)
        if operation is None or not self.stop_proven:
            return self._unknown(operation_id, None if operation is None else operation["result"])
        operation["stopped"] = True
        operation["effects_resolved"] = True
        operation["status"] = "stopped"
        return self._receipt(operation_id)

    def finish(self, operation_id, result):
        """Attach a result to a known original operation. Never creates one."""
        operation = self._operations.get(operation_id)
        if operation is None:
            raise ValueError("unknown operation")
        operation["result"] = result
        operation["status"] = "complete"
        operation["stopped"] = True
        operation["effects_resolved"] = True

    def _remember(self, operation_id):
        if operation_id not in self._operations:
            self._operations[operation_id] = {
                "status": "accepted",
                "result": None,
                "stopped": False,
                "effects_resolved": False,
                "context": {},
            }

    def _receipt(self, operation_id):
        operation = self._operations[operation_id]
        return {
            "operation_id": operation_id,
            "status": operation["status"],
            "stopped": operation["stopped"],
            "effects_resolved": operation["effects_resolved"],
            "result": operation["result"],
        }

    def _unknown(self, operation_id, result=None):
        return {
            "operation_id": operation_id,
            "status": "unknown",
            "stopped": False,
            "effects_resolved": False,
            "result": result,
        }
