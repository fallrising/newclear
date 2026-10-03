"""Dedicated loopback model endpoint; no browser, query credentials or token issuer."""

import json
from contextlib import asynccontextmanager
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from .domain import Problem
from .model_policy import MAX_REQUEST, Completion
from .model_proxy import ModelProxy


def create_model_app(db, policy, *, own_db=False):
    proxy = ModelProxy(db, policy)

    @asynccontextmanager
    async def lifespan(app):
        if own_db:
            await run_in_threadpool(db.open)
        try:
            yield
        finally:
            if own_db:
                await run_in_threadpool(db.close)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.proxy = proxy

    @app.exception_handler(Problem)
    async def problem(request, exc):
        return JSONResponse({"error": exc.code}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        return JSONResponse({"error": "model_input_invalid"}, status_code=422)

    async def unavailable(request, exc):
        return JSONResponse({"error": "model_database_unavailable"}, status_code=503)

    for kind in (psycopg.Error, PoolTimeout):
        app.add_exception_handler(kind, unavailable)

    @app.middleware("http")
    async def boundary(request, call_next):
        if (
            request.headers.get("origin") is not None
            or request.headers.get("cookie") is not None
            or request.url.query
        ):
            result = JSONResponse({"error": "model_transport_forbidden"}, status_code=403)
        else:
            result = await call_next(request)
        result.headers["Cache-Control"] = "no-store"
        result.headers["X-Content-Type-Options"] = "nosniff"
        return result

    @app.post("/v1/runs/{run_id}/chat/completions")
    async def complete(run_id: UUID, request: Request):
        authorization = request.headers.getlist("authorization")
        keys = request.headers.getlist("idempotency-key")
        if len(authorization) != 1 or not authorization[0].startswith("Bearer mp1_"):
            raise Problem(401, "model_token_invalid")
        if len(authorization[0]) > 128:
            raise Problem(401, "model_token_invalid")
        if len(keys) != 1 or len(keys[0]) != 36:
            raise Problem(422, "model_request_id_required")
        try:
            request_id = UUID(keys[0])
        except ValueError:
            raise Problem(422, "model_request_id_required") from None
        if request.headers.get("content-type", "").split(";")[0] != "application/json":
            raise Problem(415, "model_json_required")
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_REQUEST:
                raise Problem(413, "model_request_too_large")
            chunks.append(chunk)
        try:
            data = Completion.model_validate(json.loads(b"".join(chunks)))
        except (ValueError, RecursionError, ValidationError):
            raise Problem(422, "model_input_invalid") from None
        try:
            return await run_in_threadpool(
                proxy.complete, run_id, authorization[0][7:], request_id, data
            )
        except (UnicodeError, TypeError, RecursionError):
            raise Problem(422, "model_input_invalid") from None

    return app
