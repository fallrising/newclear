from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{message} ({code}, http {status})")
        self.status = status
        self.code = code
        self.message = message


@dataclass
class Message:
    id: str
    queue: str
    body: str
    metadata: Optional[Dict[str, str]]
    encryption: Optional[Dict[str, Any]]
    created_at: str


class Client:
    def __init__(self, base_url: str, api_key: str = "", timeout: float = 35.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def health(self) -> None:
        self._request("GET", "/health", auth=False)

    def enqueue(
        self,
        queue: str,
        body: str,
        metadata: Optional[Dict[str, str]] = None,
        encryption: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"body": body}
        if metadata is not None:
            payload["metadata"] = metadata
        if encryption is not None:
            payload["encryption"] = encryption
        return self._request(
            "POST",
            f"/api/v1/queue/{quote(queue, safe='')}",
            data=payload,
            content_type="application/json",
        )

    def dequeue(
        self,
        queue: str,
        *,
        peek: bool = False,
        timeout: int = 0,
    ) -> Optional[Message]:
        params = {}
        if peek:
            params["peek"] = "true"
        if timeout:
            params["timeout"] = str(timeout)
        path = f"/api/v1/queue/{quote(queue, safe='')}"
        if params:
            path = f"{path}?{urlencode(params)}"
        status, data = self._request_raw("GET", path)
        if status == 204:
            return None
        return Message(
            id=data["id"],
            queue=data["queue"],
            body=data["body"],
            metadata=data.get("metadata"),
            encryption=data.get("encryption"),
            created_at=data.get("created_at", ""),
        )

    def clear(self, queue: str) -> int:
        data = self._request("DELETE", f"/api/v1/queue/{quote(queue, safe='')}")
        return int(data.get("cleared", 0))

    def list_queues(self) -> List[Dict[str, Any]]:
        data = self._request("GET", "/api/v1/queues")
        return list(data.get("queues", []))

    def _request(
        self,
        method: str,
        path: str,
        data: Any = None,
        content_type: Optional[str] = None,
        auth: bool = True,
    ) -> Dict[str, Any]:
        status, body = self._request_raw(method, path, data=data, content_type=content_type, auth=auth)
        if status == 204:
            return {}
        return body or {}

    def _request_raw(
        self,
        method: str,
        path: str,
        data: Any = None,
        content_type: Optional[str] = None,
        auth: bool = True,
    ):
        url = f"{self.base_url}{path}"
        headers = {}
        body = None
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = content_type or "application/json"
        if auth and self.api_key:
            headers["X-API-Key"] = self.api_key
        req = Request(url, data=body, headers=headers, method=method)
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                if not raw:
                    return resp.status, {}
                return resp.status, json.loads(raw.decode("utf-8"))
        except HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
                err = payload.get("error", {})
                raise APIError(e.code, err.get("code", "HTTP_ERROR"), err.get("message", raw)) from e
            except APIError:
                raise
            except Exception:
                raise APIError(e.code, "HTTP_ERROR", raw) from e
