"""Real Memvid scenarios. The caller configures credentials and network isolation.

Each case owns new files below its already-created output directory. Assertions
raise even under ``python -O``; an SDK call or an empty result is never a pass.
"""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any, Iterator

import memvid_sdk as sdk


STAMP = 1_700_000_000


def require(condition: Any, message: str) -> None:
    if not condition:
        raise AssertionError(message)


@contextmanager
def new_memory(path: Path) -> Iterator[Any]:
    require(not path.exists() and not path.is_symlink(), "Memory destination already exists")
    memory = sdk.create(str(path), enable_vec=False, enable_lex=True)
    try:
        yield memory
        memory.seal()
    finally:
        memory.close()


@contextmanager
def open_memory(path: Path, *, writable: bool = False) -> Iterator[Any]:
    require(path.is_file(), "Existing memory file is required")
    memory = sdk.use("basic", str(path), read_only=not writable)
    try:
        yield memory
        if writable:
            memory.seal()
    finally:
        memory.close()


def put(memory: Any, uri: str, text: str, *, timestamp: int = STAMP,
        metadata: dict[str, Any] | None = None, title: str | None = None) -> int:
    return int(memory.put(
        title=title or uri, label="fixture", metadata=metadata or {"fixture": "synthetic"},
        text=text, uri=uri, timestamp=timestamp, enable_embedding=False,
        auto_tag=False, extract_dates=False,
    ))


def rebuild_index(path: Path) -> dict[str, Any]:
    """Explicit build step on a closed, newly created lab file; never a read hook."""
    report = sdk.Memvid.doctor(str(path), rebuild_lex_index=True, quiet=True)
    actions = [action for phase in report.get("phases", []) for action in phase.get("actions", [])]
    require(any(action.get("action") == "rebuild_lex_index" and action.get("status") == "executed"
                for action in actions), "Official doctor did not rebuild the lexical index")
    require(report.get("verification", {}).get("overall_status") == "passed",
            "Rebuilt lexical index failed deep verification")
    return {"policy": "write batch, seal, close, explicit doctor rebuild, reopen",
            "rebuild_lex_index": True, "status": report.get("status"),
            "executed_actions": [action["action"] for action in actions if action.get("status") == "executed"],
            "pre_rebuild_finding_codes": sorted({item["code"] for item in report.get("plan", {}).get("findings", [])}),
            "verification": "passed"}


def checked_hits(result: dict[str, Any], expected: dict[str, str]) -> list[dict[str, Any]]:
    hits = result.get("hits")
    require(isinstance(hits, list), "SDK did not return a hits list")
    require({hit.get("uri") for hit in hits} == set(expected), "Unexpected or missing source URI")
    compact: dict[tuple[int, str], dict[str, Any]] = {}
    for hit in hits:
        uri = hit["uri"]
        text = hit.get("text") or hit.get("snippet") or ""
        require(expected[uri] in text, "Returned source does not contain the expected content")
        frame_id = int(hit["frame_id"])
        compact[frame_id, uri] = {"frame_id": frame_id, "uri": uri, "excerpt": text[:240]}
    return [compact[key] for key in sorted(compact)]


def query(memory: Any, text: str, expected: dict[str, str], **options: Any) -> dict[str, Any]:
    result = memory.find(text, mode="lex", k=20, snippet_chars=2000, **options)
    return {"query": text, "hits": checked_hits(result, expected), "engine": result.get("engine")}


def guarded_context(memory: Any, question: str, *, scope: str | None = None) -> dict[str, Any]:
    """Prevent SDK ask's broad fallback from inventing relevance for no-hit queries."""
    lexical = memory.find(question, mode="lex", k=20, scope=scope)
    require(isinstance(lexical.get("hits"), list), "Lexical preflight did not return a hits list")
    if not lexical["hits"]:
        return {"question": question, "context_only": True, "answer": None,
                "context": "", "hits": [], "lexical_guard": "no_matching_source"}
    result = memory.ask(question, mode="lex", k=6, scope=scope, context_only=True, return_sources=True)
    return {**result, "lexical_guard": "matching_sources_found"}


def verify(memory: Any) -> dict[str, Any]:
    report = memory.verify(deep=True)
    require(report.get("overall_status") == "passed", "Deep memory verification failed")
    checks = report.get("checks", [])
    require(bool(checks) and all(item.get("status") == "passed" for item in checks),
            "Deep verification has missing or unsuccessful checks")
    return {"overall_status": report["overall_status"], "checks": [item["name"] for item in checks]}


def child(action: str, path: Path) -> dict[str, Any]:
    process = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), action, str(path.resolve())],
        text=True, capture_output=True, timeout=45, check=False,
    )
    require(process.returncode == 0, f"Child {action} failed with exit {process.returncode}")
    result = json.loads(process.stdout)
    require(result.pop("process_id") != os.getpid(), "Persistence check did not use a new process")
    return {"new_process": True, **result}


def resume_agent(path: Path) -> dict[str, Any]:
    with open_memory(path, writable=True) as memory:
        previous = query(memory, "checkpoint", {
            "mv2://agent/checkpoint": "inspect archive manifest before resuming",
        })
        frame_id = put(memory, "mv2://agent/continuation",
                       "Agent continuation completed archive verification; next step is restore drill.",
                       timestamp=STAMP + 10)
    repair = rebuild_index(path)
    return {"process_id": os.getpid(), "previous": previous, "appended_frame": frame_id, "index_policy": repair}


def read_portable(path: Path) -> dict[str, Any]:
    with open_memory(path) as memory:
        result = query(memory, "compass", {
            "mv2://offline/log": "compass calibration log",
        })
        integrity = verify(memory)
    return {"process_id": os.getpid(), "retrieval": result, "integrity": integrity}


def uc01(output: Path) -> dict[str, Any]:
    path = output / "uc01-agent.mv2"
    with new_memory(path) as memory:
        old_id = put(memory, "mv2://agent/checkpoint",
                     "Agent checkpoint: inspect archive manifest before resuming.")
    repair = rebuild_index(path)
    resumed = child("resume", path)
    require(resumed["appended_frame"] != old_id, "Continuation did not append a new frame")
    with open_memory(path) as memory:
        previous = query(memory, "checkpoint", {
            "mv2://agent/checkpoint": "inspect archive manifest before resuming",
        })
        continuation = query(memory, "continuation", {
            "mv2://agent/continuation": "completed archive verification",
        })
    return {"index_policy": repair, "resume": resumed, "old_memory_retained": previous, "continuation": continuation}


def uc02(output: Path) -> dict[str, Any]:
    path = output / "uc02-enterprise.mv2"
    engineering = "mv2://enterprise/engineering/runbook"
    unclassified = "mv2://enterprise/engineering/unclassified"
    sales = "mv2://enterprise/sales/handbook"
    acl = {"acl_tenant_id": "tenant-a", "acl_visibility": "restricted", "acl_read_roles": ["engineer"]}
    with new_memory(path) as memory:
        put(memory, engineering, "Rollback runbook requires health checks before switching traffic.", metadata=acl)
        put(memory, unclassified, "Rollback draft has no approved access policy.")
        put(memory, sales, "Rollback commercial handbook describes customer notifications.",
            metadata={"acl_tenant_id": "tenant-a", "acl_visibility": "restricted", "acl_read_roles": ["sales"]})
    # Keep the raw failure visible instead of silently retrying until it passes.
    with open_memory(path) as memory:
        try:
            raw = memory.find("rollback", mode="lex", k=20)
            actual = sorted({hit["uri"] for hit in raw["hits"]})
            raw_observation = {"expected_uris": sorted([engineering, unclassified, sales]),
                               "actual_uris": actual,
                               "matched_this_run": set(actual) == {engineering, unclassified, sales}}
        except Exception as error:
            raw_observation = {"matched_this_run": False, "error_type": type(error).__name__}
    repair = rebuild_index(path)
    with open_memory(path) as memory:
        scoped = query(memory, "rollback", {engineering: "health checks", unclassified: "no approved access policy"},
                       scope="mv2://enterprise/engineering/")
        allowed = query(memory, "rollback", {engineering: "health checks"},
                        scope="mv2://enterprise/engineering/", acl_context={"tenant_id": "tenant-a", "roles": ["engineer"]},
                        acl_enforcement_mode="enforce")
        denied: dict[str, Any] = {}
        for name, scope, context in [
            ("wrong_role", engineering, {"tenant_id": "tenant-a", "roles": ["sales"]}),
            ("cross_tenant", engineering, {"tenant_id": "tenant-b", "roles": ["engineer"]}),
            ("missing_metadata", unclassified, {"tenant_id": "tenant-a", "roles": ["engineer"]}),
        ]:
            denied[name] = query(memory, "rollback", {}, scope=scope,
                                 acl_context=context, acl_enforcement_mode="enforce")
    return {"native_pre_rebuild_observation": raw_observation, "index_policy": repair,
            "scope": scoped, "acl_enforcement": "enforce", "allowed": allowed, "denied": denied}


def uc03(output: Path) -> dict[str, Any]:
    path = output / "uc03-offline.mv2"
    with new_memory(path) as memory:
        put(memory, "mv2://offline/log", "Portable capsule retains the compass calibration log.")
    repair = rebuild_index(path)
    copied_dir = output / "portable-copy"
    copied_dir.mkdir(exist_ok=False)
    copied = copied_dir / "memory.mv2"
    shutil.copyfile(path, copied)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    require(hashlib.sha256(copied.read_bytes()).hexdigest() == digest, "Copied memory checksum differs")
    reopened = child("portable-read", copied)
    require({item.name for item in copied_dir.iterdir()} == {copied.name}, "Portable read requires extra sidecars")
    return {"index_policy": repair, "copied_only_mv2": True, "sha256": digest, "reopened": reopened,
            "network_policy": "inherited from the caller; see run-level isolation evidence"}


def uc04(output: Path) -> dict[str, Any]:
    path = output / "uc04-code.mv2"
    code_uri = "mv2://code/src/retry.py"
    design_uri = "mv2://code/docs/retry-design.md"
    with new_memory(path) as memory:
        put(memory, code_uri, "def retry_backoff(attempt):\n    return min(60, 2 ** attempt)\n",
            metadata={"language": "python", "fixture": "synthetic", "revision": "fixture-v1"})
        put(memory, design_uri, "retry_backoff caps exponential delay at sixty seconds to bound recovery latency.")
        put(memory, "mv2://code/src/database.sql", "SELECT account_id FROM accounts;")
    repair = rebuild_index(path)
    with open_memory(path) as memory:
        symbol_result = memory.find("retry_backoff", mode="lex", k=20)
        symbol_sources = sorted({hit["uri"] for hit in symbol_result["hits"]})
        result = query(memory, "retry", {
            code_uri: "return min(60, 2 ** attempt)", design_uri: "caps exponential delay at sixty seconds",
        })
        code = query(memory, "attempt", {code_uri: "def retry_backoff(attempt)"})
    return {"index_policy": repair, "retrieval": result, "code_content": code, "source_revision": "fixture-v1",
            "native_exact_symbol_observation": {"query": "retry_backoff", "actual_uris": symbol_sources,
                                                "missing_expected_uris": sorted({code_uri, design_uri} - set(symbol_sources))},
            "tokenizer_boundary": "Lexical tokens and code content were checked; exact underscored symbol matching is not assumed."}


def uc05(output: Path) -> dict[str, Any]:
    path = output / "uc05-support.mv2"
    expected = {"mv2://support/policy": "thirty days after purchase",
                "mv2://support/ticket-104": "twelve days after purchase"}
    with new_memory(path) as memory:
        put(memory, "mv2://support/policy", "Refund policy grants thirty days after purchase.")
        put(memory, "mv2://support/ticket-104", "Ticket 104: customer requests refund twelve days after purchase.")
    repair = rebuild_index(path)
    with open_memory(path) as memory:
        retrieval = query(memory, "refund", expected)
        unscoped = memory.ask("refund", mode="lex", k=6, context_only=True, return_sources=True)
        require(unscoped.get("answer") is None, "Context-only SDK unexpectedly generated an answer")
        contexts = []
        # Select scopes from actual retrieval, never from the expected-answer table.
        for uri in sorted({hit["uri"] for hit in retrieval["hits"]}):
            answer = guarded_context(memory, "refund", scope=uri)
            citations = checked_hits(answer, {uri: expected[uri]})
            require(answer.get("context_only") is True and answer.get("answer") is None,
                    "Support scenario unexpectedly synthesized an answer")
            context = answer.get("context") or ""
            require(uri in context and expected[uri] in context, "Context lost source citation or fact")
            contexts.append({"citations": citations, "context_excerpt": context[:400]})
        require({hit["uri"] for context in contexts for hit in context["citations"]} == set(expected),
                "Application context lost an expected retrieved source")
        raw_unknown = memory.ask("nonexistentquasar761", mode="lex", context_only=True)
        require(raw_unknown.get("answer") is None, "Context-only SDK unexpectedly generated an answer")
        unknown = guarded_context(memory, "nonexistentquasar761")
        checked_hits(unknown, {})
        require(unknown.get("answer") is None and unknown.get("context") == ""
                and unknown.get("lexical_guard") == "no_matching_source",
                "Unknown question produced unsupported context or answer")
    return {"index_policy": repair, "mode": "retrieval_context_only", "generated_answer": False,
            "retrieval": retrieval, "scoped_contexts": contexts, "unknown_hit_count": 0,
            "scope_selection": "URIs from actual lexical retrieval hits",
            "native_unscoped_ask_observation": {"raw_hit_uris": sorted({hit.get("uri") for hit in unscoped.get("hits", [])}),
                                                "raw_hit_count": len(unscoped.get("hits", []))},
            "native_unknown_ask_observation": {"raw_hit_uris": sorted({hit.get("uri") for hit in raw_unknown.get("hits", [])}),
                                                "raw_hit_count": len(raw_unknown.get("hits", [])),
                                                "application_guard": unknown["lexical_guard"]},
            "ask_boundary": "Each source is explicitly scoped; unscoped ask is not assumed to retain every lexical hit."}


def uc06(output: Path) -> dict[str, Any]:
    path = output / "uc06-workflow.mv2"
    uri = "mv2://workflow/archive-validation"
    with new_memory(path) as memory:
        pending = put(memory, uri, "Archive workflow state pending; next step validate manifest.",
                      metadata={"status": "pending", "event": "scheduled"})
        completed = put(memory, uri, "Archive workflow state completed; manifest checksum verified.",
                        timestamp=STAMP + 10, metadata={"status": "completed", "event": "validation-finished"})
    repair = rebuild_index(path)
    with open_memory(path) as memory:
        latest = query(memory, "completed", {uri: "state completed"})
        require(int(memory.frame(uri)["id"]) == completed, "URI lookup did not return current workflow frame")
        history = memory.timeline()
        ids = {int(item["frame_id"]) for item in history}
        require({pending, completed} <= ids, "Workflow history did not retain both events")
        previous = query(memory, "workflow", {uri: "state pending"}, as_of_frame=pending)
        require({int(hit["frame_id"]) for hit in latest["hits"]} == {completed}, "Wrong current workflow frame")
    return {"index_policy": repair, "latest": latest, "previous": previous, "history_frame_ids": sorted(ids),
            "application_boundary": "event persistence; no external job was executed"}


def uc07(output: Path) -> dict[str, Any]:
    path = output / "uc07-sales.mv2"
    uri = "mv2://sales/customer-cedar"
    catalog_uri = "mv2://sales/catalog"
    with new_memory(path) as memory:
        put(memory, catalog_uri, "The product catalog supports offline search, document indexing and export.")
        source_id = put(memory, uri, "Cedar Labs customer requires offline search and is in evaluation.")
        added = memory.add_memory_cards([
            {"entity": "Cedar Labs", "slot": slot, "value": value,
             "source_frame_id": source_id, "engine": "manual-fixture", "kind": "Fact"}
            for slot, value in [("requirement", "offline search"), ("stage", "evaluation")]
        ])
        require(added.get("added") == 2, "Manual fact insertion did not add both cards")
    repair = rebuild_index(path)
    with open_memory(path) as memory:
        state = memory.state("Cedar Labs")
        require(state.get("found") is True, "Customer entity was not persisted")
        slots = state.get("slots", {})
        for slot, value in [("requirement", "offline search"), ("stage", "evaluation")]:
            card = slots.get(slot, {})
            require(card.get("value") == value and int(card.get("source_frame_id", -1)) == source_id,
                    "Customer fact lost value or provenance")
            require(card.get("engine") == "manual-fixture", "Manual facts were mislabeled as automatic enrichment")
        source = query(memory, "customer", {uri: "requires offline search"})
        product = query(memory, "catalog", {catalog_uri: "supports offline search"})
        matching_evidence = query(memory, '"offline search"', {
            uri: "requires offline search", catalog_uri: "supports offline search",
        })
    return {"index_policy": repair, "insertion": "manual_memory_cards", "automatic_enrichment_tested": False,
            "state": state, "source": source, "product": product, "matching_evidence": matching_evidence}


def uc08(output: Path) -> dict[str, Any]:
    path = output / "uc08-personal.mv2"
    note_uri = "mv2://personal/backup-note"
    preference_uri = "mv2://personal/language"
    with new_memory(path) as memory:
        note_id = put(memory, note_uri, "烏龍筆記：備份完成後先驗證雜湊，再演練還原。")
        old_id = put(memory, preference_uri, "語言偏好：後續說明使用英文，保留原始來源。", timestamp=STAMP + 10)
        new_id = put(memory, preference_uri, "語言偏好：後續說明使用繁體中文，保留原始來源。", timestamp=STAMP + 20)
    repair = rebuild_index(path)
    with open_memory(path) as memory:
        note = query(memory, "烏龍筆記", {note_uri: "備份完成後先驗證雜湊"})
        preference = query(memory, "後續說明使用繁體中文", {preference_uri: "後續說明使用繁體中文"})
        require(int(memory.frame(preference_uri)["id"]) == new_id, "URI lookup did not return current language preference")
        previous = query(memory, "語言偏好", {preference_uri: "後續說明使用英文"}, as_of_frame=old_id)
        timeline = memory.timeline(since=STAMP, until=STAMP + 20)
        require({int(item["frame_id"]) for item in timeline} == {note_id, old_id, new_id},
                "Personal note timeline lost a dated frame")
    return {"index_policy": repair, "note": note, "preference": preference, "previous_preference": previous,
            "timestamps": sorted({item["timestamp"] for item in timeline}),
            "tokenizer_boundary": "Exact Chinese text spans were queried; arbitrary Chinese word segmentation is not claimed."}


def uc09(output: Path) -> dict[str, Any]:
    path = output / "uc09-domain-documents.mv2"
    documents = [
        ("medical", "Synthetic medical reference: training clinic desk is located in room seven.", "room seven"),
        ("legal", "Synthetic legal reference: sample agreement notice period is thirty days.", "thirty days"),
        ("financial", "Synthetic financial reference: sample ledger reports seven million units.", "seven million units"),
    ]
    results: dict[str, Any] = {}
    with new_memory(path) as memory:
        for domain, text, _ in documents:
            put(memory, f"mv2://domain/{domain}/reference", text, metadata={"domain": domain, "fixture": "synthetic"})
    repair = rebuild_index(path)
    with open_memory(path) as memory:
        for domain, _, needle in documents:
            uri = f"mv2://domain/{domain}/reference"
            results[domain] = query(memory, "reference", {uri: needle}, scope=f"mv2://domain/{domain}/")
        query(memory, "nonexistentquasar761", {})
    return {"index_policy": repair, "domains": results, "unknown_hit_count": 0, "professional_advice_generated": False}


def uc10(output: Path) -> dict[str, Any]:
    path = output / "uc10-audit.mv2"
    uri = "mv2://audit/release-plan"
    with new_memory(path) as memory:
        old_id = put(memory, uri, "Release plan schedules the launch on Monday.")
        new_id = put(memory, uri, "Release plan schedules the launch on Friday.", timestamp=STAMP + 10)
    repair = rebuild_index(path)
    with open_memory(path, writable=True) as memory:
        historical = query(memory, "launch", {uri: "launch on Monday"}, as_of_frame=old_id)
        require({hit["frame_id"] for hit in historical["hits"]} == {old_id}, "Historical query used a future frame")
        session_id = memory.session_start("retrieval-audit")
        before = query(memory, "Friday", {uri: "launch on Friday"})
        require(int(memory.frame(uri)["id"]) == new_id, "URI lookup did not return current release frame")
        ended = memory.session_end()
        require(ended.get("session_id") == session_id and ended.get("action_count", 0) >= 1,
                "Session did not record retrieval")
    with open_memory(path) as memory:
        sessions = memory.session_list()
        saved = [item for item in sessions if item.get("session_id") == session_id]
        require(len(saved) == 1 and saved[0].get("action_count", 0) >= 1, "Recorded session was not persisted")
        replay = memory.session_replay(session_id)
        actions = replay.get("action_results", [])
        require(replay.get("total_actions", 0) >= 1 and bool(actions), "Replay returned no actions")
        require(replay.get("mismatched_actions") == 0 and replay.get("skipped_actions") == 0,
                "Replay skipped or mismatched retrieval")
        require(any("FIND" in item.get("action_type", "").upper() and item.get("matched") is True for item in actions),
                "Replay did not execute a matching FIND action")
        after = query(memory, "Friday", {uri: "launch on Friday"})
        require(after["hits"] == before["hits"], "Replay changed current retrieval content or provenance")
        query(memory, "launch", {uri: "launch on Monday"}, as_of_frame=old_id)
        timeline_ids = {int(item["frame_id"]) for item in memory.timeline()}
        require({old_id, new_id} <= timeline_ids, "Audit timeline lost old or new content")
        integrity = verify(memory)
    return {"index_policy": repair, "historical": historical, "current": after, "history_frame_ids": sorted(timeline_ids),
            "session_persisted": True, "recorded_actions": ended["action_count"],
            "replay": {key: replay[key] for key in ["total_actions", "matched_actions", "mismatched_actions", "skipped_actions"]},
            "integrity": integrity,
            "boundary": "Recorded retrieval and append history were checked; arbitrary state restoration and LLM replay were not."}


def uc11(output: Path) -> dict[str, Any]:
    path = output / "uc11-custom.mv2"
    uri = "mv2://custom/retained"
    custom = {"retention_days": 30, "category": "prototype", "reviewed": True, "labels": ["alpha", "local"]}
    with new_memory(path) as memory:
        retained = put(memory, uri, "Retainedsapphire is the active custom application record.", metadata=custom)
        removed = put(memory, "mv2://custom/obsolete", "Obsoletequartz is a retired application record.")
    repair = rebuild_index(path)
    with open_memory(path, writable=True) as memory:
        query(memory, "obsoletequartz", {"mv2://custom/obsolete": "retired application record"})
        memory.remove(removed)
        query(memory, "obsoletequartz", {})
    with open_memory(path) as memory:
        frame = memory.frame(uri)
        require(int(frame["id"]) == retained, "Metadata lookup returned the wrong frame")
        raw = frame.get("extra_metadata", {})
        decoded = {key: json.loads(raw[key]) if isinstance(raw.get(key), str) else raw.get(key) for key in custom}
        require(decoded == custom, "Custom metadata did not round-trip")
        kept = query(memory, "retainedsapphire", {uri: "active custom application record"})
        query(memory, "obsoletequartz", {})
        integrity = verify(memory)
    return {"index_policy": repair, "metadata": decoded, "retained": kept, "removed_frame_id": removed,
            "removed_query_hits": 0, "integrity": integrity}


def minimal_pdf(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 50 750 Td ({escaped}) Tj ET\n".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"endstream",
    ]
    data = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    data.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    return bytes(data)


def pdf_ingestion(output: Path) -> dict[str, Any]:
    fixture = output / "archive-handbook.pdf"
    content = "Archive handbook: restore drills run every Thursday. Recovery code is ASTER731."
    with fixture.open("xb") as stream:
        stream.write(minimal_pdf(content))
    path = output / "pdf-ingestion.mv2"
    uri = "mv2://pdf/archive-handbook"
    with new_memory(path) as memory:
        frame_id = int(memory.put(title="Archive handbook", label="pdf", metadata={"fixture": "synthetic"},
                                  file=str(fixture), uri=uri, enable_embedding=False,
                                  auto_tag=False, extract_dates=False))
    repair = rebuild_index(path)
    with open_memory(path) as memory:
        result = query(memory, "ASTER731", {uri: "restore drills run every Thursday"})
        require(all("ASTER731" in hit["excerpt"] for hit in result["hits"]), "PDF recovery code was not extracted")
    with open_memory(path) as memory:
        reopened = query(memory, "ASTER731", {uri: "Recovery code is ASTER731"})
        integrity = verify(memory)
    return {"index_policy": repair, "ingestion": "SDK put(file=...) native PDF extraction", "frame_id": frame_id,
            "fixture_sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
            "retrieval": result, "reopened": reopened, "integrity": integrity}


CASES = [
    ("UC-01", "Long-Running AI Agents", uc01),
    ("UC-02", "Enterprise Knowledge Bases", uc02),
    ("UC-03", "Offline-First AI Systems", uc03),
    ("UC-04", "Codebase Understanding", uc04),
    ("UC-05", "Customer Support Agents", uc05),
    ("UC-06", "Workflow Automation", uc06),
    ("UC-07", "Sales and Marketing Copilots", uc07),
    ("UC-08", "Personal Knowledge Assistants", uc08),
    ("UC-09", "Medical, Legal, and Financial Agents", uc09),
    ("UC-10", "Auditable and Debuggable AI Workflows", uc10),
    ("UC-11", "Custom Applications", uc11),
    ("CAP-PDF", "PDF Ingestion", pdf_ingestion),
]


if __name__ == "__main__":
    require(len(sys.argv) == 3 and sys.argv[1] in {"resume", "portable-read"},
            "Usage: scenarios.py {resume|portable-read} EXISTING_MEMORY")
    operation = resume_agent if sys.argv[1] == "resume" else read_portable
    print(json.dumps(operation(Path(sys.argv[2])), ensure_ascii=False))
