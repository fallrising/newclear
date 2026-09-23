"""Test-only SIGKILL injection, using the real ledger and HTTP fixture transport."""

import os
import signal
import sys
from pathlib import Path
from uuid import UUID

from agent_platform.db import Database
from agent_platform.model_policy import Completion, Policy
from agent_platform.model_proxy import ModelProxy

config, token_file, run_id, request_id, stage = sys.argv[1:]
db = Database(os.environ["TEST_DATABASE_URL"])
db.open()
proxy = ModelProxy(db, Policy.read(config))
if stage == "reserved":
    original = proxy.reserve

    def kill(*args, **kwargs):
        original(*args, **kwargs)
        os.kill(os.getpid(), signal.SIGKILL)

    proxy.reserve = kill
elif stage == "response":
    original = proxy.upstream.complete

    def kill(*args, **kwargs):
        original(*args, **kwargs)
        os.kill(os.getpid(), signal.SIGKILL)

    proxy.upstream.complete = kill
elif stage == "settled":
    original = proxy.settle

    def kill(*args, **kwargs):
        original(*args, **kwargs)
        os.kill(os.getpid(), signal.SIGKILL)

    proxy.settle = kill
else:
    raise ValueError("unknown fault point")
proxy.complete(
    UUID(run_id),
    Path(token_file).read_text().strip(),
    UUID(request_id),
    Completion(model="fixture:m2", messages=[{"role": "user", "content": "test"}], max_tokens=32),
)
