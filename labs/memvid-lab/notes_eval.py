#!/usr/bin/env python3
"""Offline, fixed-corpus Memvid notes evaluation; poor quality is a valid result."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
import unicodedata

ROOT = Path(__file__).resolve().parent
STRATEGIES = ("native", "cjk_bigrams")
CATEGORIES = {"exact", "partial", "paraphrase", "mixed", "unanswerable"}
FROZEN_CORPUS_SHA256 = "a91ec99c3329ddafdf856aa74a193dcfd5f62e32273ccd4c62d9154855c1f970"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def validate_corpus(corpus):
    if corpus.get("schema_version") != 1 or "synthetic" not in corpus.get("provenance", "").lower():
        raise ValueError("Expected schema 1 with explicit synthetic provenance")
    notes, queries = corpus["notes"], corpus["queries"]
    if len(notes) != 24 or len(queries) != 30:
        raise ValueError("Frozen evaluation requires 24 notes and 30 queries")
    for entries, keys in ((notes, ("id", "uri", "title", "text")), (queries, ("id", "category", "text"))):
        for entry in entries:
            if any(not isinstance(entry.get(key), str) or not entry[key].strip() for key in keys):
                raise ValueError("Missing or empty corpus field")
        if len({entry["id"] for entry in entries}) != len(entries):
            raise ValueError("Duplicate corpus ID")
    uris = {note["uri"] for note in notes}
    if len(uris) != len(notes) or not all(re.fullmatch(r"mv2://notes/n\d{2}", uri) for uri in uris):
        raise ValueError("Duplicate or invalid note URI")
    if len({query["text"] for query in queries}) != len(queries):
        raise ValueError("Duplicate query")
    for query in queries:
        relevant = query.get("relevant_uris")
        if not isinstance(relevant, list) or any(not isinstance(uri, str) for uri in relevant):
            raise ValueError("Invalid relevant URI list")
        if len(set(relevant)) != len(relevant) or not set(relevant) <= uris:
            raise ValueError("Duplicate or unknown relevance reference")
        if query["category"] not in CATEGORIES or (not relevant) != (query["category"] == "unanswerable"):
            raise ValueError("Category and relevance disagree")
    if Counter(q["category"] for q in queries)["unanswerable"] != 6:
        raise ValueError("Expected six no-answer queries")
    if {q["category"] for q in queries} != CATEGORIES or not any(len(q["relevant_uris"]) > 1 for q in queries):
        raise ValueError("Missing category or multi-source query")
    return corpus


def search_text(text, strategy):
    if strategy == "native":
        return text
    if strategy != "cjk_bigrams":
        raise ValueError("Unknown strategy")
    normalized = unicodedata.normalize("NFKC", text).lower()
    tokens = re.findall(r"[a-z0-9]+", normalized)
    for run in re.findall(r"[\u3400-\u9fff]+", normalized):
        tokens.extend("z" + "".join(f"{ord(char):04x}" for char in run[i:i + 2])
                      for i in range(len(run) - 1))
    return " ".join(sorted(set(tokens)))


def ranked_sources(hits):
    result, seen = [], set()
    for hit in hits:
        if hit["uri"] not in seen:
            result.append(hit)
            seen.add(hit["uri"])
        if len(result) == 5:
            break
    return result


def summarize(rows):
    recalls, reciprocals = [], []
    correct = returned = raw_count = valid = unknown = false_returns = 0
    for row in rows:
        expected = set(row["relevant_uris"])
        hits = ranked_sources(row["hits"])
        ranked = [hit["uri"] for hit in hits]
        relevant = len(set(ranked) & expected)
        returned += len(hits)
        correct += relevant
        raw_count += len(row["hits"])
        valid += sum(hit["integrity_ok"] for hit in row["hits"])
        if expected:
            recalls.append(relevant / len(expected))
            reciprocals.append(next((1 / rank for rank, uri in enumerate(ranked, 1) if uri in expected), 0))
        else:
            unknown += 1
            false_returns += bool(hits)
    return {"query_count": len(rows), "answerable_count": len(recalls), "no_answer_count": unknown,
            "recall_at_5": sum(recalls) / len(recalls) if recalls else None,
            "mrr_at_5": sum(reciprocals) / len(reciprocals) if reciprocals else None,
            "source_precision": correct / returned if returned else None,
            "no_answer_false_return_rate": false_returns / unknown if unknown else None,
            "source_integrity": valid / raw_count if raw_count else None,
            "relevant_return_count": correct, "return_count": returned,
            "raw_hit_count": raw_count, "valid_raw_hit_count": valid}


def payload(note, strategy):
    original = note["title"] + "\n" + note["text"]
    return original if strategy == "native" else original + "\n\nLab CJK index:\n" + search_text(original, strategy)


def append_note(memory, note, strategy):
    from scenarios import put
    text = payload(note, strategy)
    frame_id = put(memory, note["uri"], text, title=note["title"])
    return frame_id, {"uri": note["uri"], "title": note["title"], "text": text}


def source_matches(hit, expected):
    """Check full SDK-rendered content, including exact known metadata, not a substring."""
    if hit["uri"] != expected.get("uri") or not expected.get("text"):
        return False
    normalize = lambda text: " ".join(unicodedata.normalize("NFKC", text).split())
    rendered = (normalize(expected["text"]) + " title: " + normalize(expected["title"])
                + " uri: " + expected["uri"] + ' labels: fixture fixture: "synthetic"')
    return hit["text"] == rendered


def build(path, notes, strategy):
    from scenarios import new_memory, rebuild_index
    started = time.perf_counter()
    manifest = {}
    with new_memory(path) as memory:
        for note in notes:
            frame_id, original = append_note(memory, note, strategy)
            manifest[str(frame_id)] = original
    written = time.perf_counter()
    repair = rebuild_index(path)
    done = time.perf_counter()
    return manifest, {"write_seal_seconds": written - started, "rebuild_seconds": done - written,
                      "total_seconds": done - started, "file_bytes": path.stat().st_size, "index_policy": repair}


def find(memory, query, strategy, manifest):
    transformed = search_text(query, strategy)
    if not transformed.strip():
        return []
    result = memory.find(transformed, mode="lex", k=20, snippet_chars=8000)
    if not isinstance(result.get("hits"), list):
        raise ValueError("SDK response has no hits array")
    hits = []
    for hit in result["hits"]:
        frame_id, uri = int(hit["frame_id"]), hit["uri"]
        actual = hit.get("text") or hit.get("snippet") or ""
        expected = manifest.get(str(frame_id), {})
        valid = source_matches({"uri": uri, "text": actual}, expected)
        hits.append({"uri": uri, "frame_id": frame_id, "score": hit.get("score"),
                     "text": actual, "integrity_ok": valid})
    return hits


def current_view(memory, hits):
    return [hit for hit in hits if int(memory.frame(hit["uri"])["id"]) == hit["frame_id"]]


def quality(output, corpus, strategy):
    from scenarios import open_memory
    path = output / "notes.mv2"
    manifest, costs = build(path, corpus["notes"], strategy)
    rows = []
    with open_memory(path) as memory:
        for query in corpus["queries"]:
            hits = find(memory, query["text"], strategy, manifest)
            rows.append({**query, "transformed_query": search_text(query["text"], strategy),
                         "hits": hits, "ranked_uris": [h["uri"] for h in ranked_sources(hits)]})
    score = summarize(rows)
    return {"strategy": strategy, "queries": rows, "metrics": score, "source_manifest": manifest,
            "by_category": {category: summarize([q for q in rows if q["category"] == category]) for category in sorted(CATEGORIES)},
            "costs": costs, "memory_sha256": digest(path)}


def updates(output, strategy):
    from scenarios import open_memory, rebuild_index
    uri = "mv2://updates/meeting"
    old = {"uri": uri, "title": "讀書會行程", "text": "readingclub 週一在松林教室。舊版代碼 amberold。"}
    new = {**old, "text": "readingclub 週三在海風教室。新版代碼 coppernew。"}
    removed = {"uri": "mv2://updates/removed", "title": "過期借用", "text": "cancelledloan 已取消的雨傘借用紀錄。"}
    path = output / "updates.mv2"
    manifest, costs = build(path, [old, removed], strategy)
    old_id, removed_id = (next(int(key) for key, item in manifest.items() if item["uri"] == item_uri)
                          for item_uri in (uri, removed["uri"]))
    with open_memory(path, writable=True) as memory:
        new_id, original = append_note(memory, new, strategy)
        manifest[str(new_id)] = original
        memory.remove(removed_id)
    repair = rebuild_index(path)
    write_json(output / "manifest.json", manifest)
    # New interpreter, inherited seccomp, actual persisted bytes; no parent handle survives.
    process = subprocess.run([sys.executable, str(Path(__file__).resolve()), "_reopen", str(output), strategy,
                              str(old_id), str(new_id)], capture_output=True, text=True, timeout=30)
    if process.returncode:
        raise RuntimeError("Reopen verification failed: " + process.stderr[-1500:])
    result = json.loads(process.stdout)
    return {"strategy": strategy, "initial_costs": costs, "update_index_policy": repair, **result}


def reopen_check(output, strategy, old_id, new_id):
    from scenarios import open_memory, require
    manifest = json.loads((output / "manifest.json").read_text())
    with open_memory(output / "updates.mv2") as memory:
        raw = find(memory, "readingclub", strategy, manifest)
        current = current_view(memory, raw)
        newest = find(memory, "coppernew", strategy, manifest)
        old_hits = find(memory, "amberold", strategy, manifest)
        deleted = find(memory, "cancelledloan", strategy, manifest)
        current_id = int(memory.frame("mv2://updates/meeting")["id"])
        timeline_ids = {int(frame["frame_id"]) for frame in memory.timeline()}
        require(current_id == new_id and {old_id, new_id} <= timeline_ids, "Current/history lookup mismatch")
        require(bool(current) and all(hit["frame_id"] == new_id for hit in current), "Current view missing or stale")
        require(any(hit["frame_id"] == new_id for hit in newest), "New version not searchable")
        require(not current_view(memory, old_hits) and not deleted, "Old/deleted result in current view")
        require(all(hit["integrity_ok"] for hit in raw + newest + old_hits), "Incorrect update source")
    return {"current_view_passed": True, "new_process_reopen": True, "deleted_absent": True,
            "old_frame_id": old_id, "current_frame_id": new_id, "history_contains_both": True,
            "native_common_hits": raw, "native_old_term_hits": old_hits,
            "current_view_hits": current, "native_new_term_hits": newest,
            "policy": "Native append preserves history; application current view filters by frame(uri).id; delete uses native remove."}


def percentile(values, quantile):
    return sorted(values)[max(0, math.ceil(quantile * len(values)) - 1)]


def scale(output, corpus, strategy, size):
    from scenarios import open_memory
    notes = list(corpus["notes"])
    notes.extend({"uri": f"mv2://distractors/{i:04d}", "title": f"標本目錄 {i:04d}",
                  "text": f"合成干擾筆記：岩石標本編號 specimen{i:04d}，灰色顆粒，存於抽屜 {i % 50:02d}。"}
                 for i in range(size - len(notes)))
    path = output / "scale.mv2"
    manifest, costs = build(path, notes, strategy)
    queries = corpus["queries"][:10]
    samples, first = [], []
    with open_memory(path) as memory:
        for round_number in range(6):
            for query in queries:
                started = time.perf_counter()
                hits = find(memory, query["text"], strategy, manifest)
                elapsed = (time.perf_counter() - started) * 1000
                if not all(h["integrity_ok"] for h in hits):
                    raise ValueError("Invalid source in scale query")
                (first if round_number == 0 else samples).append(elapsed)
    return {"strategy": strategy, "note_count": len(notes), "costs": costs,
            "query_ids": [q["id"] for q in queries], "first_pass_ms": first,
            "warm_samples_ms": samples, "warm_sample_count": len(samples),
            "warm_p50_ms": percentile(samples, 0.5), "warm_p95_ms": percentile(samples, 0.95),
            "timing_scope": "find + source validation, excludes file open; first pass is not OS cold-cache; five warmed repetitions",
            "memory_sha256": digest(path)}


def decision(quality_result, update_result):
    score = quality_result["metrics"]
    thresholds = {"recall_at_5": 0.9, "mrr_at_5": 0.8, "source_precision": 0.8, "source_integrity": 1}
    checks = {key: score[key] is not None and score[key] >= limit for key, limit in thresholds.items()}
    checks["no_answer_false_return_rate"] = score["no_answer_false_return_rate"] == 0
    checks["current_view"] = update_result["current_view_passed"]
    return {"strategy": quality_result["strategy"], "recommendation": "candidate_for_further_trial" if all(checks.values()) else "do_not_adopt_directly",
            "checks": checks, "failed_criteria": [key for key, passed in checks.items() if not passed]}


def run(args):
    corpus_path = args.corpus.resolve()
    corpus = validate_corpus(json.loads(corpus_path.read_text()))
    if digest(corpus_path) != FROZEN_CORPUS_SHA256:
        raise ValueError("Corpus bytes differ from the pre-retrieval frozen fixture")
    sizes = [int(value) for value in args.sizes.split(",")]
    if not sizes or len(set(sizes)) != len(sizes) or any(size < 24 or size > 1000 for size in sizes):
        raise ValueError("Use unique sizes between 24 and 1000")
    args.output.mkdir(parents=True, exist_ok=False)
    output = args.output.resolve()
    from offline import local_environment, deny_network
    local_environment()
    network = deny_network()
    report = {"schema_version": 1, "started_at": datetime.now(timezone.utc).isoformat(),
              "evaluation_completed": False, "corpus_sha256": digest(corpus_path), "provenance": corpus["provenance"],
              "sources": {name: digest(ROOT / name) for name in ("notes_eval.py", "offline.py", "scenarios.py", "requirements.lock")},
              "python": platform.python_version(), "platform": f"{platform.system()} {platform.machine()}",
              "sdk_version": importlib.metadata.version("memvid-sdk"), "network": network,
              "native_core_version": "2.0.140 (checked in every worker)",
              "measurement_conditions": "Shared Linux host; single sequential evaluation; no exclusive CPU/OS cache control; build timings include explicit index rebuild",
              "source_check": "Exact full SDK-rendered NFKC/whitespace-normalized text and known metadata; URI/frame checked against input manifest, not raw-byte storage round-trip",
              "quality": [], "updates": [], "scale": [], "errors": []}
    if report["sdk_version"] != "2.0.160":
        raise ValueError("Install pinned SDK 2.0.160")
    for strategy in STRATEGIES:
        for job, size in [("quality", 24), ("updates", 24)] + [("scale", n) for n in sizes]:
            destination = output / f"{strategy}-{job}-{size}"
            destination.mkdir()
            command = [sys.executable, str(Path(__file__).resolve()), "_worker", job, str(destination),
                       str(corpus_path), strategy, str(size)]
            try:
                process = subprocess.run(command, capture_output=True, text=True, timeout=180)
                if process.returncode:
                    raise RuntimeError(process.stderr[-2000:])
                result = json.loads(process.stdout)
                report[job].append(result)
                if job == "quality" and result["metrics"]["source_integrity"] != 1:
                    raise ValueError("Source integrity failed or has no actual hits; native results retained in quality")
            except (subprocess.TimeoutExpired, RuntimeError, ValueError) as exc:
                # Preserve evidence without absolute temporary paths or an entire raw trace.
                error = str(exc).replace(str(ROOT), "<component>").replace(str(output), "<output>")
                report["errors"].append({"strategy": strategy, "job": job, "size": size, "error": error})
            write_json(output / "report.json", report)
    if not report["errors"]:
        report["evaluation_completed"] = True
        report["decisions"] = [decision(q, u) for q, u in zip(report["quality"], report["updates"])]
    report["ended_at"] = datetime.now(timezone.utc).isoformat()
    write_json(output / "report.json", report)
    print(json.dumps({"evaluation_completed": report["evaluation_completed"], "errors": report["errors"],
                      "decisions": report.get("decisions", [])}, ensure_ascii=False))
    return 0 if report["evaluation_completed"] else 1


def main():
    if len(sys.argv) > 1 and sys.argv[1] in {"_worker", "_reopen"}:
        from offline import local_environment, deny_network
        local_environment()
        network = deny_network()
        import memvid_sdk as sdk
        if sdk.info()["native"]["memvid_core_version"] != "2.0.140":
            raise ValueError("Unexpected Memvid core")
        if sys.argv[1] == "_reopen":
            result = reopen_check(Path(sys.argv[2]), sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
        else:
            _, _, job, directory, corpus_path, strategy, size = sys.argv
            corpus = validate_corpus(json.loads(Path(corpus_path).read_text()))
            result = (quality(Path(directory), corpus, strategy) if job == "quality" else
                      updates(Path(directory), strategy) if job == "updates" else
                      scale(Path(directory), corpus, strategy, int(size)))
        print(json.dumps({**result, "network": network}, ensure_ascii=False, allow_nan=False))
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    evaluate = sub.add_parser("run")
    evaluate.add_argument("--output", type=Path, required=True)
    evaluate.add_argument("--corpus", type=Path, default=ROOT / "fixtures/notes.json")
    evaluate.add_argument("--sizes", default="100,1000")
    args = parser.parse_args()
    try:
        return run(args)
    except (ValueError, OSError, KeyError) as exc:
        print(f"Evaluation failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
