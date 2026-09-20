from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import TypeVar


T = TypeVar("T")


class InferenceCapacityError(Exception):
    """Raised when request or inference capacity is unavailable."""


class AdmissionController:
    def __init__(
        self, *, max_concurrency: int, max_queue_size: int, queue_timeout: float
    ) -> None:
        self._capacity = max_concurrency + max_queue_size
        self._admitted = 0
        self._admission_lock = asyncio.Lock()
        self._inference_slots = asyncio.Semaphore(max_concurrency)
        self._queue_timeout = queue_timeout
        self._workers: set[asyncio.Task[object]] = set()

    @asynccontextmanager
    async def admit(self):
        async with self._admission_lock:
            if self._admitted >= self._capacity:
                raise InferenceCapacityError
            self._admitted += 1
        try:
            yield
        finally:
            async with self._admission_lock:
                self._admitted -= 1

    async def run(self, operation: Callable[[], T]) -> T:
        try:
            await asyncio.wait_for(
                self._inference_slots.acquire(), timeout=self._queue_timeout
            )
        except TimeoutError as exc:
            raise InferenceCapacityError from exc

        try:
            worker = asyncio.create_task(asyncio.to_thread(operation))
        except BaseException:
            self._inference_slots.release()
            raise

        self._workers.add(worker)

        def worker_finished(completed: asyncio.Task[object]) -> None:
            self._workers.discard(completed)
            self._inference_slots.release()
            if not completed.cancelled():
                completed.exception()

        worker.add_done_callback(worker_finished)
        return await asyncio.shield(worker)
