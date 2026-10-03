"""Read a fresh, lock-protected state snapshot, never persist its private contents.

The pinned Agent Server REST ConversationInfo is backed by autosaved state and
can lag a control mutation. Each WebSocket subscription creates a new full_state
under the conversation lock. This snapshot is not a durable history event.
"""

import json
import socket
import time
from urllib.parse import urlsplit

from websockets.sync.client import connect

from .domain import Problem


def live_state(row, http):
    url = http.origin.replace("http", "ws", 1) + "/sockets/events/" + row["run_id"]
    parsed = urlsplit(url)
    deadline = time.monotonic() + 10
    # An explicit socket prevents redirects; no environment proxy sees the token.
    with socket.create_connection(
        (parsed.hostname, parsed.port or (443 if parsed.scheme == "wss" else 80)), timeout=5
    ) as raw_socket:
        raw_socket.settimeout(None)
        with connect(
            url,
            sock=raw_socket,
            proxy=None,
            open_timeout=5,
            close_timeout=1,
            max_size=8 * 1024 * 1024,
        ) as ws:
            ws.send(json.dumps({"type": "auth", "session_api_key": http.token}))
            for _ in range(100):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                item = json.loads(ws.recv(timeout=remaining))
                if (
                    item.get("kind") != "ConversationStateUpdateEvent"
                    or item.get("key") != "full_state"
                ):
                    continue
                value = item["value"]
                if value.get("id") != row["run_id"]:
                    raise Problem(409, "control_conversation_mismatch")
                return {
                    key: value.get(key)
                    for key in ("id", "execution_status", "confirmation_policy", "leaf_event_id")
                }
    raise Problem(409, "control_live_state_unconfirmed")
