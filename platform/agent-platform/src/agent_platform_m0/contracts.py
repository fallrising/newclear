"""Observed upstream contracts pinned by the SDD research and M0 image."""

OPENHANDS_SHA = "856d99d48e4b11c70c5f1cab21e7830570dbc324"
OPENHANDS_VERSION = "1.49.2"
OPENHANDS_IMAGE = (
    "ghcr.io/openhands/agent-server@sha256:"
    "8d015443e480ce5fa0f6f0b21b8031d5b2115840805e28eac89f5d82799ea51b"
)
SANDBOX_SHA = "5a800317f15554400c989d9de4c5ab5c1cacf7da"
SANDBOX_SDK_VERSION = "0.1.12"
REQUIRED_ROUTES = {
    "/ready": ("get",),
    "/server_info": ("get",),
    "/api/conversations": ("post",),
    "/api/conversations/{conversation_id}": ("get", "delete"),
    "/api/conversations/{conversation_id}/events": ("post",),
    "/api/conversations/{conversation_id}/events/search": ("get",),
    "/api/conversations/{conversation_id}/run": ("post",),
    "/api/conversations/{conversation_id}/pause": ("post",),
    "/api/conversations/{conversation_id}/interrupt": ("post",),
}

# A Docker run cannot discharge any of these MicroVM acceptance obligations.
PENDING_KVM_GATES = [
    "cocoon_guest_boot_and_template_digest",
    "sandbox_rest_and_websocket_relay",
    "cross_workspace_and_egress_isolation",
    "sandbox_ttl_and_allocation_reconciliation",
    "microvm_stop_and_confirmed_resource_release",
]
