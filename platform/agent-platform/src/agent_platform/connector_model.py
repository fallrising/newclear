"""Authenticated host-pulled mailbox, serialized with existing control mutations."""

import socket
from contextlib import contextmanager
from uuid import UUID

from agent_platform_m0.transport import HTTP

from .connector_output import OutputPolicy
from .domain import Problem
from .model_policy import MAX_RESPONSE, canonical


@contextmanager
def relay(service, row):
    listener = service.handle(row).proxy_port("127.0.0.1:0", 18080)
    try:
        yield HTTP(f"http://127.0.0.1:{listener.getsockname()[1]}", row["session_key"], timeout=5)
    finally:
        try:
            listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        listener.close()


def exchange(service, run_id, data):
    with service.journal.locked(run_id):
        row = service.require(run_id, data.generation)
        service.guard(row)
        if not row["input"].get("model_transport"):
            raise Problem(409, "model_transport_not_configured")
        service.isolation(row)
        if row["operations"].get("release"):
            raise Problem(409, "sandbox_release_started")
        with relay(service, row) as http:
            if data.action == "credential":
                if not data.token or data.revision < 1:
                    raise Problem(422, "model_credential_invalid")
                old = row.get("model_credential", {})
                version = (data.generation, data.revision)
                previous = (old.get("generation", 0), old.get("revision", 0))
                if version < previous or (version == previous and data.token != old.get("token")):
                    raise Problem(409, "model_credential_stale")
                tokens = row.setdefault("model_tokens", [])
                if data.token not in tokens:
                    if len(tokens) >= 256:
                        raise Problem(409, "model_rotation_limit")
                    tokens.append(data.token)
                row["model_credential"] = {
                    "generation": data.generation,
                    "revision": data.revision,
                    "token": data.token,
                }
                service.journal.write(row)  # Redact even an uncertain delivered credential.
                result = http.expect("POST", "/credential", row["model_credential"])
                if result != {"generation": data.generation, "revision": data.revision}:
                    raise Problem(409, "model_credential_unconfirmed")
                return result
            if data.action == "poll":
                result = http.expect("GET", "/mailbox")
                pending = result.get("pending")
                if pending is not None:
                    if (
                        set(pending) != {"run_id", "generation", "token", "request_id", "payload"}
                        or pending["run_id"] != str(run_id)
                        or pending["generation"] != data.generation
                        or pending["token"] != row.get("model_credential", {}).get("token")
                    ):
                        raise Problem(409, "model_mailbox_identity_mismatch")
                    UUID(pending["request_id"])
                    OutputPolicy(service, row).require_safe(
                        pending["payload"], "model_sensitive_request"
                    )
                return result
            if data.action != "deliver" or data.request_id is None or data.response is None:
                raise Problem(422, "model_exchange_invalid")
            OutputPolicy(service, row).require_safe(data.response, "model_sensitive_response")
            if len(canonical(data.response)) > MAX_RESPONSE:
                raise Problem(422, "model_response_too_large")
            from .connector import fingerprint

            payload = {
                "generation": data.generation,
                "request_id": str(data.request_id),
                "response": data.response,
            }

            def effect():
                service.guard(row)
                return http.expect("POST", "/response", payload)

            return service.journal.operation(
                row, "model:" + str(data.request_id), fingerprint(payload), effect
            )
