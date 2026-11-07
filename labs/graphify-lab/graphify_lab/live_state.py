"""Explicit, serialized refresh of a validated local Graphify snapshot."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import threading
from typing import Callable, TypeVar

from .cache import CacheError, context_fingerprint, runtime_identity, source_fingerprint
from .workspace import open_workspace

T = TypeVar('T')
_CHECK_ERRORS = (CacheError, OSError, ValueError, KeyError, TypeError,
                 subprocess.TimeoutExpired)


def _canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


class LiveWorkspaceError(RuntimeError):
    """A current snapshot could not be established; no read result is returned."""

    def __init__(self, message: str, *, state: dict | None = None):
        super().__init__(message)
        self.state = deepcopy(state)


class LiveWorkspace:
    """A session's active index; external source edits require explicit refresh.

    Validation is observational, not a filesystem lock against editors. The
    lock serializes this object's readers and refreshes, while before/after
    checks discard results if relevant inputs change during an operation.
    """

    def __init__(self, source: Path, cache: Path):
        self._lock = threading.RLock()
        self.source = Path(source).expanduser().resolve(strict=True)
        self.cache = Path(cache).expanduser().resolve()
        self._index, self._runtime = self._candidate()

    @property
    def index(self) -> dict:
        """Return provenance without giving callers mutable internal state."""
        with self._lock:
            return deepcopy(self._index)

    def _candidate(self) -> tuple[dict, dict]:
        index = open_workspace(self.source, self.cache)
        # Capture the runtime that actually built this index, not a newer
        # runtime observed after open_workspace returned.
        metadata = Path(index['index_root']) / 'index.json'
        if metadata.is_symlink():
            raise CacheError('index metadata cannot be a symlink')
        identity = json.loads(metadata.read_text())['identity']
        if hashlib.sha256(_canonical(identity).encode()).hexdigest() != index['index_id']:
            raise CacheError('index identity changed while opening the live snapshot')
        runtime = identity['runtime']
        self._require(self._check(index, runtime))
        return index, runtime

    def _check(self, index: dict, runtime: dict) -> dict:
        result = deepcopy(index)
        try:
            if self.source.resolve(strict=True) != self.source or not self.source.is_dir():
                raise CacheError('source directory identity changed')
            # Integrity errors take precedence over a benign source edit.
            graph = Path(index['graph'])
            entry = Path(index['index_root'])
            if (entry.is_symlink() or graph.is_symlink() or not graph.is_file()
                    or graph.resolve(strict=True) != graph):
                raise CacheError('index graph is absent or reached through a symlink')
            if hashlib.sha256(graph.read_bytes()).hexdigest() != index['graph_sha256']:
                raise CacheError('index graph integrity mismatch')
            changed = []
            if source_fingerprint(self.source) != index['source_fingerprint']:
                changed.append('source')
            if context_fingerprint(self.source)['sha256'] != index['context_sha256']:
                changed.append('context')
            if _canonical(runtime_identity()) != _canonical(runtime):
                changed.append('runtime')
            if changed:
                return {**result, 'status': 'stale',
                        'reason': ', '.join(changed) + ' changed; refresh_workspace is required'}
            return {**result, 'status': 'current'}
        except _CHECK_ERRORS as exc:
            return {**result, 'status': 'error', 'reason': str(exc)}

    @staticmethod
    def _require(status: dict) -> None:
        if status['status'] != 'current':
            raise LiveWorkspaceError(status['reason'], state=status)

    def status(self) -> dict:
        """Inspect the active snapshot without extracting or switching indexes."""
        with self._lock:
            return self._check(self._index, self._runtime)

    def refresh(self) -> dict:
        """Switch only after the candidate's source, context and graph validate."""
        with self._lock:
            try:
                index, runtime = self._candidate()
            except (*_CHECK_ERRORS, LiveWorkspaceError) as exc:
                raise LiveWorkspaceError(f'refresh failed: {exc}', state=self.status()) from exc
            self._index, self._runtime = index, runtime
            return {**deepcopy(index), 'status': 'current'}

    def execute(self, callback: Callable[[dict], T]) -> T:
        """Run a reader only while its snapshot validates before and afterward."""
        with self._lock:
            index, runtime = self._index, self._runtime
            self._require(self._check(index, runtime))
            failure = None
            try:
                result = callback(deepcopy(index))
            except Exception as exc:
                failure = exc
            # Validate outside the except block so stale query diagnostics do
            # not become the implicit context of a freshness error either.
            self._require(self._check(index, runtime))
            if failure is not None:
                raise failure
            return result
