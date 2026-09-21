"""Authenticated API and durable SSE; workers run as a separate process."""

import asyncio
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

import psycopg
from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from psycopg_pool import PoolTimeout
from starlette.concurrency import run_in_threadpool

from .auth import Auth
from .config import Settings
from .db import Database
from .domain import Login, Problem, ProfileInput, ProjectInput, RetryInput, TaskInput
from .store import Store, json_value


def command_response(result):
    headers = {"Location": result["location"]} if "location" in result else {}
    return JSONResponse(result["body"], status_code=result["status"], headers=headers)


def create_app(settings=None, db=None, web_dist=None):
    settings = settings or Settings.from_env()
    own_db = db is None
    db = db or Database(settings.database_url)
    auth, store = Auth(db, settings), Store(db)
    authenticated = Depends(auth.require)

    @asynccontextmanager
    async def lifespan(app):
        if own_db:
            await run_in_threadpool(db.open)
        try:
            yield
        finally:
            if own_db:
                await run_in_threadpool(db.close)

    app = FastAPI(
        title="Agent Platform M1",
        version="0.2.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.db = db
    app.state.settings = settings

    @app.exception_handler(Problem)
    async def problem(request, exc):
        headers = {"Retry-After": "300"} if exc.status == 429 else None
        return JSONResponse({"error": exc.code}, status_code=exc.status, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        return JSONResponse(
            {"error": "invalid_input", "fields": [list(e["loc"]) for e in exc.errors()]},
            status_code=422,
        )

    async def unavailable(request, exc):
        return JSONResponse({"error": "database_unavailable"}, status_code=503)

    app.add_exception_handler(psycopg.OperationalError, unavailable)
    app.add_exception_handler(PoolTimeout, unavailable)

    @app.middleware("http")
    async def headers(request, call_next):
        if request.url.path.startswith("/api/") and request.method in {"POST", "PUT", "PATCH"}:
            chunks = []
            size = 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > 65536:
                    return JSONResponse({"error": "request_too_large"}, status_code=413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["Cache-Control"] = (
            "no-store" if request.url.path.startswith("/api/") else "no-cache"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "connect-src 'self'; img-src 'self' data:; frame-ancestors "
            "'none'; base-uri 'none'; object-src 'none'; form-action 'self'"
        )
        return response

    @app.get("/api/v1/session")
    def session(request: Request, response: Response):
        return auth.session_view(request, response)

    @app.post("/api/v1/session")
    def login(data: Login, request: Request, response: Response):
        return auth.login(request, response, data)

    @app.delete("/api/v1/session", status_code=204)
    def logout(request: Request, response: Response):
        auth.logout(request, response)

    @app.get("/api/v1/projects")
    def projects(session=authenticated):
        return {"items": store.projects()}

    @app.post("/api/v1/projects", status_code=201)
    def project(
        data: ProjectInput,
        session=authenticated,
        idempotency_key: str | None = Header(default=None),
    ):
        return command_response(
            store.command(
                session["operator_id"],
                "projects.create",
                idempotency_key,
                data,
                lambda conn, _: store.create_project(conn, data),
            )
        )

    @app.get("/api/v1/agent-profiles")
    def profiles(session=authenticated):
        return {"items": store.profiles()}

    @app.post("/api/v1/agent-profiles", status_code=201)
    def profile(
        data: ProfileInput,
        session=authenticated,
        idempotency_key: str | None = Header(default=None),
    ):
        return command_response(
            store.command(
                session["operator_id"],
                "profiles.create",
                idempotency_key,
                data,
                lambda conn, _: store.create_profile(conn, data),
            )
        )

    @app.get("/api/v1/tasks")
    def tasks(
        cursor: str | None = Query(default=None, max_length=512),
        limit: int = Query(default=30, ge=1, le=100),
        session=authenticated,
    ):
        return store.tasks(cursor, limit)

    @app.post("/api/v1/tasks", status_code=202)
    def task(
        data: TaskInput,
        session=authenticated,
        idempotency_key: str | None = Header(default=None),
    ):
        operator = session["operator_id"]
        return command_response(
            store.command(
                operator,
                "tasks.create",
                idempotency_key,
                data,
                lambda conn, command_id: store.create_task(conn, operator, data, command_id),
            )
        )

    @app.get("/api/v1/tasks/{task_id}")
    def task_detail(task_id: UUID, session=authenticated):
        return store.task(task_id)

    @app.post("/api/v1/tasks/{task_id}/runs", status_code=202)
    def retry(
        task_id: UUID,
        data: RetryInput,
        session=authenticated,
        idempotency_key: str | None = Header(default=None),
    ):
        return command_response(
            store.command(
                session["operator_id"],
                f"tasks/{task_id}/runs.create",
                idempotency_key,
                data,
                lambda conn, command_id: store.retry(conn, task_id, data, command_id),
            )
        )

    @app.get("/api/v1/runs/{run_id}")
    def run(run_id: UUID, session=authenticated):
        return store.run(run_id)

    @app.get("/api/v1/runs/{run_id}/events")
    async def events(
        run_id: UUID,
        request: Request,
        after_seq: int = Query(default=0, ge=0),
        follow: bool = True,
        last_event_id: str | None = Header(default=None),
        session=authenticated,
    ):
        after = after_seq
        if last_event_id is not None:
            try:
                after = max(after, int(last_event_id))
                if int(last_event_id) < 0:
                    raise ValueError()
            except ValueError:
                raise Problem(422, "invalid_event_cursor") from None
        initial = await run_in_threadpool(store.events, run_id, after)
        token = request.cookies.get(settings.session_cookie)

        async def stream():
            cursor, batch = after, initial
            deadline = time.monotonic() + settings.stream_seconds
            while True:
                if not await run_in_threadpool(auth.lookup, token):
                    yield "event: session_expired\ndata: {}\n\n"
                    return
                for row in batch:
                    cursor = row["seq"]
                    payload = json.dumps(json_value(row), ensure_ascii=False)
                    yield f"id: {cursor}\ndata: {payload}\n\n"
                if not follow or time.monotonic() >= deadline or await request.is_disconnected():
                    return
                yield ": keepalive\n\n"
                await asyncio.sleep(0.5)
                try:
                    batch = await run_in_threadpool(store.events, run_id, cursor)
                except Problem as exc:
                    yield f"event: stream_error\ndata: {json.dumps({'error': exc.code})}\n\n"
                    return

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
        )

    @app.get("/api/v1/runtime")
    def runtime(session=authenticated):
        return store.runtime()

    @app.get("/api/v1/openapi.json", include_in_schema=False)
    def schema(session=authenticated):
        return JSONResponse(jsonable_encoder(app.openapi()))

    if web_dist:
        app.mount("/", StaticFiles(directory=Path(web_dist), html=True), name="web")
    return app
