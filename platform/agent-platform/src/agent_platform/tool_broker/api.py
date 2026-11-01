"""Opt-in, separate mock broker ASGI app; no browser, grant issuer or guest route."""

import asyncio
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout

from ..domain import Problem
from .broker import Broker


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate key")
        value[key] = item
    return value


def create_tool_app(db, policy, *, adapter=None):
    """Host fixture harness supplies explicit immutable mock config and open DB.

    Run separately from the lifecycle API/worker. The application cannot provision
    a grant and is not mounted in the normal control app. Four active requests,
    no executor queue; SQL also enforces the run's cross-process operation cap.
    """
    broker = Broker(db, policy, adapter=adapter)
    executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="tool-broker")
    slots = threading.BoundedSemaphore(4)

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            executor.shutdown(wait=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.broker = broker

    @app.exception_handler(Problem)
    async def problem(request, exc):
        return JSONResponse({"error": exc.code}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        return JSONResponse({"error": "tool_input_invalid"}, status_code=422)

    async def unavailable(request, exc):
        return JSONResponse({"error": "tool_database_unavailable"}, status_code=503)

    for kind in (psycopg.Error, PoolTimeout):
        app.add_exception_handler(kind, unavailable)

    @app.middleware("http")
    async def boundary(request, call_next):
        if (
            request.headers.get("origin") is not None
            or request.headers.get("cookie") is not None
            or request.url.query
        ):
            response = JSONResponse({"error": "tool_transport_forbidden"}, status_code=403)
        else:
            response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    async def body(request):
        if (
            request.headers.get("content-type", "").split(";")[0] != "application/json"
            or request.headers.get("content-encoding") is not None
        ):
            raise Problem(415, "tool_json_required")
        auth = request.headers.getlist("authorization")
        if len(auth) != 1 or not auth[0].startswith("Bearer tb1_") or len(auth[0]) > 128:
            raise Problem(401, "tool_token_invalid")

        async def read():
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 32768:
                    raise Problem(413, "tool_request_too_large")
            return raw

        try:
            raw = await asyncio.wait_for(read(), timeout=5)
            value = json.loads(raw, object_pairs_hook=unique_object)
            if not isinstance(value, dict):
                raise ValueError
        except TimeoutError:
            raise Problem(408, "tool_request_timeout") from None
        except (ValueError, RecursionError, UnicodeError):
            raise Problem(422, "tool_input_invalid") from None
        return auth[0][7:], value

    async def dispatch(function, *args):
        if not slots.acquire(blocking=False):
            raise Problem(503, "tool_busy")

        def work():
            try:
                return function(*args)
            finally:
                slots.release()

        # Cancellation of the HTTP waiter must not free a still-active network slot.
        future = executor.submit(work)
        return await asyncio.shield(asyncio.wrap_future(future))

    @app.post("/tb1/runs/{run_id}/operations/{operation_id}")
    async def execute(run_id: UUID, operation_id: UUID, request: Request):
        token, payload = await body(request)
        return await dispatch(broker.execute, run_id, token, operation_id, payload)

    @app.post("/tb1/runs/{run_id}/operations/{operation_id}/ack")
    async def acknowledge(run_id: UUID, operation_id: UUID, request: Request):
        token, payload = await body(request)
        if set(payload) != {"receipt"}:
            raise Problem(422, "tool_input_invalid")
        return await dispatch(broker.acknowledge, run_id, token, operation_id, payload["receipt"])

    return app
