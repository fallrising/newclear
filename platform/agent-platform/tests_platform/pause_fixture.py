"""Pinned admission policy and process observations behind connector HTTP."""

from contextlib import contextmanager

from approval_fixture import ApprovalConnector


class PauseConnector(ApprovalConnector):
    def prepare(self, row):
        result = super().prepare(row)
        self.policy = "AlwaysConfirm" if row["input"]["require_approval"] else "NeverConfirm"
        self.status = "waiting_for_confirmation" if row["input"]["require_approval"] else "running"
        self.busy = False
        self.same_boot = self.same_processes = True
        self.resume_calls = self.policy_calls = 0
        self.lose_resume = self.lose_gate = False
        self.resume_pending_reads = 0
        return result

    def prompt(self, row, goal):
        row["guest_baseline"] = {"fixture": True}
        self.journal.write(row)
        return super().prompt(row, goal)

    def quiescence(self, row, baseline=None):
        self.client.check()
        return {"same_boot": self.same_boot, "same_processes": self.same_processes}

    def conversation(self, row, http):
        value = http.expect("GET", "/api/conversations/" + row["run_id"])
        if self.resume_calls and self.resume_pending_reads:
            self.resume_pending_reads -= 1
            value["execution_status"] = "waiting_for_confirmation"
        return value

    @contextmanager
    def relay(self, row):
        with super().relay(row) as upstream:
            service = self

            class AgentHTTP:
                def expect(self, method, path, data=None):
                    service.client.check()
                    if path.endswith("/confirmation_policy"):
                        service.policy_calls += 1
                        service.policy = data["policy"]["kind"]
                        if (
                            service.policy == "AlwaysConfirm"
                            and not service.busy
                            and service.status == "running"
                        ):
                            service.status = "waiting_for_confirmation"
                        if service.lose_gate:
                            raise TimeoutError("gate reply lost")
                        return {"success": True}
                    if path.endswith("/run"):
                        service.resume_calls += 1
                        result = upstream.expect(
                            "POST",
                            path.replace("/run", "/events/respond_to_confirmation"),
                            {"accept": True},
                        )
                        if service.lose_resume:
                            raise TimeoutError("resume reply lost")
                        return result
                    result = upstream.expect(method, path, data)
                    if "confirmation_policy" in result:
                        result["confirmation_policy"] = {"kind": service.policy}
                    return result

            yield AgentHTTP()
