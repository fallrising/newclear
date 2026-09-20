import asyncio
import threading

import pytest

from ocr_service.concurrency import AdmissionController, InferenceCapacityError


def test_admission_cardinality_is_bounded_and_released() -> None:
    async def scenario() -> None:
        controller = AdmissionController(
            max_concurrency=1, max_queue_size=1, queue_timeout=0.01
        )
        async with controller.admit():
            async with controller.admit():
                with pytest.raises(InferenceCapacityError):
                    async with controller.admit():
                        pass
        async with controller.admit():
            pass

    asyncio.run(scenario())


def test_inference_timeout_releases_capacity_for_a_later_request() -> None:
    async def scenario() -> None:
        controller = AdmissionController(
            max_concurrency=1, max_queue_size=1, queue_timeout=0.01
        )
        started = threading.Event()
        release = threading.Event()

        def blocking_operation() -> str:
            started.set()
            release.wait(timeout=1)
            return "first"

        first = asyncio.create_task(controller.run(blocking_operation))
        await asyncio.to_thread(started.wait, 1)
        with pytest.raises(InferenceCapacityError):
            await controller.run(lambda: "second")
        release.set()
        assert await first == "first"
        assert await controller.run(lambda: "third") == "third"

    asyncio.run(scenario())


def test_cancellation_holds_slot_until_worker_thread_finishes() -> None:
    async def scenario() -> None:
        controller = AdmissionController(
            max_concurrency=1, max_queue_size=1, queue_timeout=0.05
        )
        started = threading.Event()
        release = threading.Event()

        def blocking_operation() -> str:
            started.set()
            release.wait(timeout=1)
            return "cancelled"

        first = asyncio.create_task(controller.run(blocking_operation))
        await asyncio.to_thread(started.wait, 1)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first

        try:
            with pytest.raises(InferenceCapacityError):
                await controller.run(lambda: "must-not-run")
        finally:
            release.set()

        assert await controller.run(lambda: "later") == "later"

    asyncio.run(scenario())
