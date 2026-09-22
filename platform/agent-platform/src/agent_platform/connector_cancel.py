"""Cancel the owned VM, never confuse an interrupt ACK with process termination."""

from .connector_recovery import observe_sandbox


def cancel(service, run_id, generation):
    from .connector import fingerprint

    with service.journal.locked(run_id):
        service.fences.require(run_id, generation)
        row = service.journal.read(run_id)
        if row is None:
            # No intent existed under the serialized admission lock. The tombstone
            # also prevents a delayed allocation after this cancellation completes.
            row = {
                "run_id": str(run_id),
                "generation": generation,
                "operations": {},
                "no_allocation_intent": True,
            }
        else:
            row = service.require(run_id, generation)
        row["cancel_requested"] = True
        service.journal.write(row)
        if row.get("no_allocation_intent"):
            return {"observed_state": "not_allocated", "proof": {"no_allocation_intent": True}}
        removal = observe_sandbox(service, row)
        if removal:
            return removal

        def interrupt():
            service.guard(row, stopping=True)
            with service.relay(row) as http:
                # Bounded HTTP request, no retry. Paused does not establish tool stop.
                http.expect("POST", "/api/conversations/" + row["run_id"] + "/interrupt")
            return {"acknowledged": True}

        if row["operations"].get("prepare", {}).get("state") == "completed":
            try:
                service.journal.operation(row, "cancel_interrupt", "interrupt-v1", interrupt)
            except Exception:
                # An uncertain interrupt cannot veto stopping the owned VM.
                pass
        payload = {"generation": row["input"]["generation"], "action": "release", "goal": ""}
        return service.journal.operation(
            row, "release", fingerprint(payload), lambda: service.release(row)
        )
