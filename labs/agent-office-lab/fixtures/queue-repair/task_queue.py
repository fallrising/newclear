def next_task(tasks):
    # BUG: dispatches despite active work and ignores queue order.
    return tasks[0]['id'] if tasks else None
