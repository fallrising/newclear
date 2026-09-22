"""Pinned approval semantics behind the real connector HTTP boundary."""

import copy
from contextlib import contextmanager

from recovery_fixture import FixtureConnector

from agent_platform_m0.contracts import OPENHANDS_SHA, OPENHANDS_VERSION


class ApprovalConnector(FixtureConnector):
    def prepare(self, row):
        result = super().prepare(row)
        self.history = [
            {
                "id": "action-1",
                "kind": "ActionEvent",
                "tool_name": "terminal",
                "tool_call_id": "tool-1",
                "action": {"kind": "TerminalAction", "command": "echo reviewed"},
            }
        ]
        self.status = "waiting_for_confirmation"
        self.accepts = 0
        self.executed = []
        self.lose_approval = False
        return result

    @contextmanager
    def relay(self, row):
        service = self

        class AgentHTTP:
            def expect(self, method, path, data=None):
                service.client.check()
                if path == "/server_info":
                    return {"build_git_sha": OPENHANDS_SHA, "version": OPENHANDS_VERSION}
                if path.endswith("/respond_to_confirmation"):
                    assert data == {"accept": True}
                    service.accepts += 1
                    actions = [e for e in service.history if e["kind"] == "ActionEvent"]
                    for action in actions:
                        service.executed.append(action["id"])
                        service.history.append(
                            {
                                "id": "result-" + action["id"],
                                "kind": "ObservationEvent",
                                "action_id": action["id"],
                                "tool_call_id": action["tool_call_id"],
                            }
                        )
                    service.status = "finished"
                    if service.lose_approval:
                        raise TimeoutError("lost confirmation reply")
                    return {"success": True}
                if "/events/search" in path:
                    return {"items": copy.deepcopy(service.history)}
                return {
                    "id": row["run_id"],
                    "execution_status": service.status,
                    "confirmation_policy": {"kind": "AlwaysConfirm"},
                    "leaf_event_id": service.history[-1]["id"],
                }

        yield AgentHTTP()
