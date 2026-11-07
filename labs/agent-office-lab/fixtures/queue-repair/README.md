# Single-worker task queue

Repair `task_queue.py` without changing the public tests or this specification.

`next_task(tasks)` returns the ID of the next task to start, or `None`:

- Any task in `starting`, `running`, `waiting_input`, or `cancelling` blocks dispatch.
- Otherwise, select only `queued` tasks, choosing the smallest integer `created_at`.
- Equal timestamps preserve input order.
- Empty queues or queues with no queued tasks return `None`.
- Do not mutate the input list or its dictionaries.

Each task has `id` (string), `state` (string), and `created_at` (integer).
Terminal states include `completed`, `failed`, `cancelled`, and `interrupted`.
Unrecognized states are ignored. Use only the Python standard library.

Run the public checks with `python3 -m unittest -v`.
