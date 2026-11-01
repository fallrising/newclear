#!/usr/bin/env python3
"""M3: dev-only calibration, frozen holdout and real offline Memvid semantic search."""
from __future__ import annotations
import argparse
import base64
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
from notes_eval import (CATEGORIES, FROZEN_CORPUS_SHA256, digest, write_json, validate_corpus,
                        summarize, percentile, current_view)
from semantic_models import MODELS, LocalEncoder, verify_assets

ROOT = Path(__file__).resolve().parent
HELDOUT_SHA256 = "75fcd6855b8bffd3d843eb89e2c81782049a2b88dd8ead2ee7d6c9fa4752df5a"
THRESHOLDS = tuple(i / 100 for i in range(101))


def now():
    return datetime.now(timezone.utc).isoformat()


def load_corpora(dev_path, heldout_path):
    result = {}
    for name, path, expected in (("dev", dev_path, FROZEN_CORPUS_SHA256), ("heldout", heldout_path, HELDOUT_SHA256)):
        if digest(path) != expected:
            raise ValueError(f"{name} corpus differs from frozen bytes")
        result[name] = validate_corpus(json.loads(Path(path).read_text()))
    return result


def filter_rows(rows, threshold):
    result = []
    for row in rows:
        for hit in row["hits"]:
            score = hit["cosine"]
            if not isinstance(score, (int, float)) or not math.isfinite(score) or not -1 <= score <= 1:
                raise ValueError("Invalid cosine score")
        result.append({**row, "hits": [h for h in row["hits"] if h["cosine"] >= threshold]})
    return result


def calibrate(dev_rows):
    candidates = []
    for threshold in THRESHOLDS:
        metrics = summarize(filter_rows(dev_rows, threshold))
        feasible = (metrics["source_precision"] is not None and metrics["source_precision"] >= .8
                    and metrics["no_answer_false_return_rate"] == 0)
        candidates.append({"threshold": threshold, "metrics": metrics, "feasible": feasible})
    feasible = [c for c in candidates if c["feasible"]]
    if feasible:
        best = max(feasible, key=lambda c: (c["metrics"]["recall_at_5"], c["metrics"]["mrr_at_5"],
                                           c["metrics"]["source_precision"], c["threshold"]))
        threshold, status = best["threshold"], "feasible"
    else:
        threshold, status = 1.01, "no_feasible_threshold"
    return {"threshold": threshold, "selection_status": status, "candidates": candidates,
            "metrics": summarize(filter_rows(dev_rows, threshold)), "source_split": "dev"}


def metrics_by_category(rows):
    return {category: summarize([r for r in rows if r["category"] == category]) for category in sorted(CATEGORIES)}


def pack_vectors(vectors, row_ids):
    import numpy as np
    array = np.asarray(vectors, dtype="<f4")
    data = array.tobytes()
    return {"encoding": "float32-le-base64", "shape": list(array.shape), "row_ids": row_ids,
            "sha256": hashlib.sha256(data).hexdigest(), "data": base64.b64encode(data).decode("ascii")}


def document(note):
    return {"uri": note["uri"], "title": note["title"], "text": note["title"] + "\n" + note["text"],
            "label": "fixture", "metadata": {"fixture": "synthetic"}, "timestamp": 1700000000}


def source_entry(doc, model):
    normalize = lambda text: " ".join(unicodedata.normalize("NFKC", text).split())
    rendered = (normalize(doc["text"]) + " title: " + normalize(doc["title"])
                + " uri: " + doc["uri"] + ' fixture: "synthetic"'
                + " memvid.embedding.dimension: " + str(MODELS[model]["dimension"])
                + " memvid.embedding.model: " + MODELS[model]["repository"]
                + " memvid.embedding.normalized: true memvid.embedding.provider: local-onnx")
    return {**{key: doc[key] for key in ("uri", "title", "text")}, "rendered": rendered}


def source_matches(hit, expected):
    return (bool(expected.get("rendered")) and hit.get("uri") == expected.get("uri")
            and hit.get("text") == expected["rendered"])


def put_vectors(memory, docs, vectors, model):
    ids = memory.put_many(docs, embeddings=vectors,
                          embedding_identity={"provider": "local-onnx", "model": MODELS[model]["repository"],
                                              "dimension": MODELS[model]["dimension"], "normalized": True},
                          opts={"enable_embedding": False, "auto_tag": False, "extract_dates": False})
    if len(ids) != len(docs) or len(set(ids)) != len(ids):
        raise ValueError("SDK ingest returned incorrect frame count")
    return [int(i) for i in ids]


def build(path, notes, encoder):
    import memvid_sdk as sdk
    if path.exists() or path.is_symlink():
        raise FileExistsError("Memory already exists")
    docs = [document(n) for n in notes]
    started = time.perf_counter()
    vectors = encoder.encode([d["text"] for d in docs])
    embedded = time.perf_counter()
    memory = sdk.create(str(path), enable_vec=True, enable_lex=True)
    try:
        ids = put_vectors(memory, docs, vectors, encoder.model)
        memory.seal()
        integrity = memory.verify(deep=True)
        if integrity.get("overall_status") != "passed":
            raise ValueError("SDK memory verification failed")
    finally:
        memory.close()
    finished = time.perf_counter()
    manifest = {str(i): source_entry(d, encoder.model) for i, d in zip(ids, docs)}
    vector_map = {str(i): v for i, v in zip(ids, vectors)}
    return manifest, vector_map, {"note_count": len(ids), "embedding_seconds": embedded - started,
                                 "write_seal_verify_seconds": finished - embedded, "total_seconds": finished - started,
                                 "file_bytes": path.stat().st_size, "deep_verify": "passed",
                                 "ingest_policy": "real model embeddings -> native put_many -> seal -> verify -> close"}


def find(memory, text, vector, manifest, vector_map, *, k=5):
    import numpy as np
    result = memory.find(text, mode="sem", query_embedding=vector, k=k, snippet_chars=8000)
    if not isinstance(result.get("hits"), list):
        raise ValueError("SDK response lacks hits")
    hits = []
    for hit in result["hits"]:
        frame = str(int(hit["frame_id"]))
        actual = hit.get("text") or hit.get("snippet") or ""
        valid = source_matches({"uri": hit["uri"], "text": actual}, manifest.get(frame, {}))
        if frame not in vector_map:
            raise ValueError("Returned frame has no ingested vector")
        # Frozen contract: reject every out-of-range cosine, including numerical drift.
        score = float(np.dot(np.asarray(vector, dtype=np.float32), np.asarray(vector_map[frame], dtype=np.float32)))
        if not math.isfinite(score) or not -1 <= score <= 1:
            raise ValueError("Invalid computed cosine")
        hits.append({"uri": hit["uri"], "frame_id": int(frame), "score": hit.get("score"),
                     "cosine": score, "text": actual, "integrity_ok": valid})
    return hits, result.get("engine")


def quality(output, corpus, model, cache):
    from scenarios import open_memory
    started = time.perf_counter()
    encoder = LocalEncoder(cache, model)
    loaded = time.perf_counter()
    manifest, vectors, costs = build(output / "notes.mv2", corpus["notes"], encoder)
    query_vectors = encoder.encode([q["text"] for q in corpus["queries"]], query=True)
    rows = []
    with open_memory(output / "notes.mv2") as memory:
        for query, vector in zip(corpus["queries"], query_vectors):
            hits, engine = find(memory, query["text"], vector, manifest, vectors)
            rows.append({**query, "hits": hits, "requested_mode": "sem", "native_engine": engine})
    return {"model": model, "queries": rows, "metrics": summarize(rows), "by_category": metrics_by_category(rows),
            "source_manifest": manifest, "graph": encoder.graph, "assets": encoder.asset_manifest,
            "document_vectors": pack_vectors(list(vectors.values()), list(vectors)),
            "query_vectors": pack_vectors(query_vectors, [q["id"] for q in corpus["queries"]]),
            "encoder_load_seconds": loaded - started, "costs": costs, "memory_sha256": digest(output / "notes.mv2")}


def updates(output, model, cache):
    from scenarios import open_memory
    encoder = LocalEncoder(cache, model)
    old = {"uri": "mv2://updates/meeting", "title": "讀書會行程", "text": "讀書會週一在松林教室，討論山林散文。"}
    new = {**old, "text": "讀書會改為週三在海風教室，討論海洋散文。"}
    removed = {"uri": "mv2://updates/removed", "title": "過期借用", "text": "已取消的雨傘借用紀錄，原定週五歸還。"}
    path = output / "updates.mv2"
    manifest, vectors, costs = build(path, [old, removed], encoder)
    old_id, removed_id = (int(next(i for i, d in manifest.items() if d["uri"] == uri))
                          for uri in (old["uri"], removed["uri"]))
    new_doc = document(new)
    new_vector = encoder.encode([new_doc["text"]])[0]
    with open_memory(path, writable=True) as memory:
        new_id = put_vectors(memory, [new_doc], [new_vector], model)[0]
        memory.remove(removed_id)
    manifest[str(new_id)] = source_entry(new_doc, model)
    vectors[str(new_id)] = new_vector
    texts = ["讀書會在哪一天、哪個教室舉行？", "借來的雨傘原本什麼時候歸還？"]
    control = {"manifest": manifest, "vectors": vectors, "old_id": old_id, "new_id": new_id,
               "removed_id": removed_id, "texts": texts, "query_vectors": encoder.encode(texts, query=True)}
    write_json(output / "control.json", control)
    process = subprocess.run([sys.executable, str(ROOT / "semantic_eval.py"), "_reopen", str(output)],
                             capture_output=True, text=True, timeout=60)
    if process.returncode:
        raise RuntimeError("Reopen control failed: " + process.stderr[-1200:])
    return {"model": model, "initial_costs": costs, **json.loads(process.stdout)}


def reopen(output):
    from scenarios import open_memory
    control = json.loads((output / "control.json").read_text())
    raw, current = [], []
    with open_memory(output / "updates.mv2") as memory:
        for text, vector in zip(control["texts"], control["query_vectors"]):
            hits, engine = find(memory, text, vector, control["manifest"], control["vectors"], k=10)
            raw.extend(hits)
            current.extend(current_view(memory, hits))
        timeline = {int(f["frame_id"]) for f in memory.timeline()}
        current_id = int(memory.frame("mv2://updates/meeting")["id"])
    if (current_id != control["new_id"] or not {control["old_id"], control["new_id"]} <= timeline
            or not any(h["frame_id"] == current_id for h in current)
            or any(h["frame_id"] in {control["old_id"], control["removed_id"]} for h in current)
            or any(h["frame_id"] == control["removed_id"] for h in raw)
            or not all(h["integrity_ok"] for h in raw)):
        raise ValueError("Semantic current/delete/reopen/source control failed")
    return {"new_process_reopen": True, "current_view_passed": True, "deleted_absent": True,
            "old_frame_id": control["old_id"], "current_frame_id": current_id, "removed_frame_id": control["removed_id"],
            "history_contains_both": True, "native_hits": raw, "current_view_hits": current,
            "policy": "Native append and historical retrieval recorded; explicit frame(uri).id filter; native remove."}


def scale(output, corpus, model, cache, size):
    from scenarios import open_memory
    started = time.perf_counter()
    encoder = LocalEncoder(cache, model)
    loaded = time.perf_counter()
    notes = list(corpus["notes"])
    notes.extend({"uri": f"mv2://distractors/{i:04d}", "title": f"標本目錄 {i:04d}",
                  "text": f"合成干擾筆記：岩石標本編號 specimen{i:04d}，灰色顆粒，存於抽屜 {i % 50:02d}。"}
                 for i in range(size - len(notes)))
    manifest, vectors, costs = build(output / "scale.mv2", notes, encoder)
    first, warm = [], []
    with open_memory(output / "scale.mv2") as memory:
        for repetition in range(4):
            for query in corpus["queries"][:10]:
                tick = time.perf_counter()
                vector = encoder.encode([query["text"]], query=True)[0]
                hits, _ = find(memory, query["text"], vector, manifest, vectors)
                elapsed = (time.perf_counter() - tick) * 1000
                if not hits or not all(h["integrity_ok"] for h in hits):
                    raise ValueError("Scale source control failed or had no actual hits")
                (first if repetition == 0 else warm).append(elapsed)
    return {"model": model, "note_count": len(notes), "costs": costs, "encoder_load_seconds": loaded - started,
            "query_ids": [q["id"] for q in corpus["queries"][:10]], "first_pass_ms": first, "warm_samples_ms": warm,
            "warm_sample_count": len(warm), "warm_p50_ms": percentile(warm, .5), "warm_p95_ms": percentile(warm, .95),
            "source_checks_passed": True, "memory_sha256": digest(output / "scale.mv2"),
            "timing_scope": "query encode + native sem search + source check; excludes file open; first pass not OS cold cache"}


def decision(result, update):
    score = result["filtered_metrics"]
    checks = {key: score[key] is not None and score[key] >= limit for key, limit in
              {"recall_at_5": .9, "mrr_at_5": .8, "source_precision": .8}.items()}
    checks.update({"no_answer_false_return_rate": score["no_answer_false_return_rate"] == 0,
                   "raw_source_integrity": result["metrics"]["source_integrity"] == 1,
                   "current_view": update["current_view_passed"]})
    return {"model": result["model"], "split": "heldout", "checks": checks,
            "recommendation": "candidate_for_further_trial" if all(checks.values()) else "do_not_adopt_directly",
            "failed_criteria": [key for key, passed in checks.items() if not passed]}


def run(args):
    if args.output.exists() or args.output.is_symlink():
        raise FileExistsError("Output already exists; not overwritten")
    corpora = load_corpora(args.dev, args.heldout)
    sizes = [] if args.sizes == "none" else [int(x) for x in args.sizes.split(",")]
    if len(set(sizes)) != len(sizes) or any(n not in (100, 1000) for n in sizes):
        raise ValueError("Use sizes100,1000 or none")
    from offline import local_environment, deny_network
    local_environment()
    network = deny_network()
    assets = verify_assets(args.cache)
    from semantic_sdk import activate
    patched_sdk = activate()
    import memvid_sdk as sdk
    if importlib.metadata.version("memvid-sdk") != "2.0.160" or sdk.info()["native"]["memvid_core_version"] != "2.0.140":
        raise ValueError("Unexpected SDK/core version")
    args.output.mkdir(parents=True, exist_ok=False)
    output = args.output.resolve()
    report = {"schema_version": 1, "started_at": now(), "evaluation_completed": False,
              "quality_completed": False, "scale_completed": False, "scale_requested": sizes,
              "corpora": {"dev": digest(args.dev), "heldout": digest(args.heldout)}, "network": network,
              "sources": {name: digest(ROOT / name) for name in ("semantic_eval.py", "semantic_models.py", "notes_eval.py", "models.py",
                          "offline.py", "scenarios.py", "semantic_sdk.py", "prepare_semantic_sdk.py", "semantic-sdk.patch", "semantic-sdk-lock.patch", "requirements.lock", "requirements-models.lock", "docs/notes-semantic.md")},
              "versions": {name: importlib.metadata.version(name) for name in ("memvid-sdk", "numpy", "onnxruntime", "tokenizers")},
              "patched_sdk": patched_sdk, "native_core_version": "2.0.140", "python": platform.python_version(), "platform": f"{platform.system()} {platform.machine()}",
              "models": MODELS, "assets": assets, "quality": [], "baselines": [], "updates": [], "scale": [], "errors": [],
              "source_check": "Full SDK-rendered normalized text plus exact fixture metadata and frame/URI ingest manifest; not raw-byte round-trip",
              "measurement_conditions": "Shared CPU host; no exclusive load/cache control; one build per scale; synthetic corpus"}
    write_json(output / "report.json", report)

    def job(kind, model, split="dev", size=24):
        destination = output / f"{model}-{kind}-{split}-{size}"
        destination.mkdir()
        corpus_path = args.dev if split == "dev" else args.heldout
        try:
            process = subprocess.run([sys.executable, str(ROOT / "semantic_eval.py"), "_worker", kind, str(destination),
                                      str(corpus_path.resolve()), model, str(args.cache.resolve()), str(size)],
                                     capture_output=True, text=True, timeout=300)
            if process.returncode:
                raise RuntimeError(process.stderr[-1800:])
            result = {**json.loads(process.stdout), "split": split, "completed_at": now()}
            report["baselines" if kind == "baseline" else kind].append(result)
            if kind in ("baseline", "quality") and result["metrics"]["source_integrity"] != 1:
                raise ValueError("Raw source integrity failed or had no actual hits")
            write_json(output / "report.json", report)
            return result
        except (subprocess.TimeoutExpired, RuntimeError, ValueError) as error:
            message = str(error).replace(str(ROOT), "<component>").replace(str(output), "<output>").replace(str(args.cache), "<cache>")
            message = re.sub(r"/(?:home|tmp|opt)/[^\s]+", "<local-path>", message)
            report["errors"].append({"kind": kind, "model": model, "split": split, "size": size, "error": message})
            write_json(output / "report.json", report)
            return None

    development = {model: job("quality", model) for model in MODELS}
    if all(development.values()) and not report["errors"]:
        calibration = {"source_split": "dev", "corpus_sha256": FROZEN_CORPUS_SHA256, "created_at": now(),
                       "protocol_sha256": report["sources"]["docs/notes-semantic.md"],
                       "models": {m: calibrate(development[m]["queries"]) for m in MODELS}}
        write_json(output / "calibration.json", calibration)
        report["calibration"] = calibration
        report["calibration_sha256"] = digest(output / "calibration.json")
        write_json(output / "report.json", report)
        for model in MODELS:
            threshold = calibration["models"][model]["threshold"]
            report.setdefault("heldout_started_at", now())
            heldout = job("quality", model, "heldout")
            for result in (development[model], heldout):
                if result is not None:
                    filtered = filter_rows(result["queries"], threshold)
                    result.update({"threshold": threshold, "filtered_metrics": summarize(filtered),
                                   "filtered_by_category": metrics_by_category(filtered),
                                   "filtered_query_hits": {r["id"]: [h["frame_id"] for h in r["hits"]] for r in filtered}})
            if digest(output / "calibration.json") != report["calibration_sha256"]:
                raise ValueError("Calibration changed after holdout began")
            job("updates", model)
        for split in ("dev", "heldout"):
            for strategy in ("native", "cjk_bigrams"):
                job("baseline", strategy, split)
        report["quality_completed"] = not report["errors"]
        if report["quality_completed"]:
            report["decisions"] = [decision(next(q for q in report["quality"] if q["model"] == model and q["split"] == "heldout"),
                                                   next(u for u in report["updates"] if u["model"] == model)) for model in MODELS]
        for model in MODELS:
            for size in sizes:
                job("scale", model, size=size)
    report["scale_completed"] = bool(sizes) and len(report["scale"]) == len(MODELS) * len(sizes) and not report["errors"]
    report["evaluation_completed"] = report["quality_completed"] and not report["errors"] and (not sizes or report["scale_completed"])
    report["ended_at"] = now()
    write_json(output / "report.json", report)
    print(json.dumps({"evaluation_completed": report["evaluation_completed"], "scale_completed": report["scale_completed"],
                      "errors": report["errors"], "decisions": report.get("decisions", [])}, ensure_ascii=False))
    return 0 if report["evaluation_completed"] else 1


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ("_worker", "_reopen"):
        from offline import local_environment, deny_network
        local_environment()
        network = deny_network()
        from semantic_sdk import activate
        patched_sdk = activate()
        if sys.argv[1] == "_reopen":
            result = reopen(Path(sys.argv[2]))
        else:
            _, _, kind, directory, corpus_path, model, cache, size = sys.argv
            output = Path(directory)
            corpus = validate_corpus(json.loads(Path(corpus_path).read_text()))
            if kind == "baseline":
                from notes_eval import quality as lexical_quality
                result = lexical_quality(output, corpus, model)
            elif kind == "quality":
                result = quality(output, corpus, model, Path(cache))
            elif kind == "updates":
                result = updates(output, model, Path(cache))
            elif kind == "scale":
                result = scale(output, corpus, model, Path(cache), int(size))
            else:
                raise ValueError("Unknown worker job")
        print(json.dumps({**result, "network": network, "patched_sdk": patched_sdk}, ensure_ascii=False, allow_nan=False))
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run",))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--dev", type=Path, default=ROOT / "fixtures/notes.json")
    parser.add_argument("--heldout", type=Path, default=ROOT / "fixtures/notes-heldout.json")
    parser.add_argument("--sizes", default="100,1000")
    args = parser.parse_args()
    try:
        return run(args)
    except (ValueError, OSError, KeyError) as error:
        print(f"Semantic evaluation failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
