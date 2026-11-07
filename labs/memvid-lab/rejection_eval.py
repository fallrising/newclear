#!/usr/bin/env python3
"""M4 fixed query rejection, dev-only selection and fresh offline native evaluation."""
from __future__ import annotations

import argparse
from collections import Counter
import importlib.metadata
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import unicodedata

from notes_eval import digest, write_json, percentile, summarize
from rejection_policy import FAMILIES, MODEL_ORDER, calibrate, decide, features, native_top1_metrics, select_primary, summarize_decisions
from semantic_eval import now, build, find, pack_vectors, metrics_by_category, updates
from semantic_models import MODELS, LocalEncoder, verify_assets

ROOT = Path(__file__).resolve().parent
# Filled from the reviewed pre-inference freeze; never inferred from current input.
FROZEN = {'dev': '20e5aad0491620b6eacfb1b87cb479a994ce7a6ac5a5b0f49e233124a121c7d6', 'heldout': '190460ecf9c77997b7c21fc362069d41428a621e386a44218dec9520b6de787f', 'protocol': '4c4685ea5aba39c2b4c334fd8b7befd8cd8d52390088da3b5f796dd1c7f95c37'}
FREEZE_COMMIT = "b3b420d81e9b97818585aa51c5ec7998eca92a35"
POSITIVE = ("exact", "partial", "paraphrase", "mixed")
NEGATIVE = ("out_of_domain", "near_miss", "missing_attribute")


def normalized(value):
    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


def validate_corpus(corpus, split):
    if split not in ("dev", "heldout") or not isinstance(corpus, dict):
        raise ValueError("Invalid corpus split or object")
    if type(corpus.get("schema_version")) is not int or corpus["schema_version"] != 1 or "synthetic" not in str(corpus.get("provenance", "")).lower():
        raise ValueError("Expected schema1 and explicit synthetic provenance")
    notes, queries = corpus.get("notes"), corpus.get("queries")
    if not isinstance(notes, list) or not isinstance(queries, list) or len(notes) != 24 or len(queries) != 48:
        raise ValueError("M4 requires24notes/48queries")
    prefix = "d" if split == "dev" else "h"
    for entries, keys in ((notes, ("id", "uri", "title", "text")), (queries, ("id", "category", "text", "rationale"))):
        for entry in entries:
            if not isinstance(entry, dict) or any(not isinstance(entry.get(key), str) or not entry[key].strip() for key in keys):
                raise ValueError("Missing or invalid corpus field")
        if len({entry["id"] for entry in entries}) != len(entries) or len({normalized(entry["text"]) for entry in entries}) != len(entries):
            raise ValueError("Duplicate corpus identity or normalized text")
    if {n["id"] for n in notes} != {f"{prefix}{i:02d}" for i in range(1, 25)}:
        raise ValueError("Invalid note IDs")
    if {q["id"] for q in queries} != {f"{prefix}q{i:02d}" for i in range(1, 49)}:
        raise ValueError("Invalid query IDs")
    for note in notes:
        if note["uri"] != f"mv2://rejection-{split}/{note['id']}":
            raise ValueError("Invalid or mismapped note URI")
    uris = {n["uri"] for n in notes}
    categories, negatives = Counter(), Counter()
    for query in queries:
        gold = query.get("relevant_uris")
        if not isinstance(gold, list) or any(not isinstance(uri, str) or uri not in uris for uri in gold):
            raise ValueError("Unknown or invalid gold URI")
        category = query["category"]
        categories[category] += 1
        if category == "unanswerable":
            if gold or query.get("negative_type") not in NEGATIVE:
                raise ValueError("Invalid unanswerable label or type")
            negatives[query["negative_type"]] += 1
        elif category not in POSITIVE or len(gold) != 1 or "negative_type" in query:
            raise ValueError("Positive queries require one gold and no negative type")
    if categories != Counter({**{c: 6 for c in POSITIVE}, "unanswerable": 24}) or negatives != Counter({n: 8 for n in NEGATIVE}):
        raise ValueError("Incorrect fixed category counts")
    return corpus


def load_corpora(dev, heldout):
    result = {}
    for split, path in (("dev", dev), ("heldout", heldout)):
        if digest(path) != FROZEN[split]:
            raise ValueError(f"{split} differs from frozen bytes")
        result[split] = validate_corpus(json.loads(path.read_text()), split)
    if digest(ROOT / "docs/notes-rejection.md") != FROZEN["protocol"] or FREEZE_COMMIT == "pending":
        raise ValueError("M4 protocol/freeze is not fixed")
    seen = set()
    for split in ("dev", "heldout"):
        current = {normalized(e[key]) for kind, keys in (("notes", ("title", "text")), ("queries", ("text",)))
                   for e in result[split][kind] for key in keys}
        if current & seen:
            raise ValueError("Cross-split normalized text overlap")
        seen |= current
    for old in ("notes.json", "notes-heldout.json"):
        corpus = json.loads((ROOT / "fixtures" / old).read_text())
        old_texts = {normalized(e[key]) for kind, keys in (("notes", ("title", "text")), ("queries", ("text",)))
                     for e in corpus[kind] for key in keys}
        if old_texts & seen:
            raise ValueError("M4 duplicates old corpus text")
    return result



def quality(output, corpus, model, cache):
    from scenarios import open_memory
    tick = time.perf_counter()
    encoder = LocalEncoder(cache, model)
    loaded = time.perf_counter() - tick
    manifest, vectors, costs = build(output / "notes.mv2", corpus["notes"], encoder)
    tick = time.perf_counter()
    query_vectors = encoder.encode([q["text"] for q in corpus["queries"]], query=True)
    query_encode_seconds = time.perf_counter() - tick
    rows, native_samples = [], []
    with open_memory(output / "notes.mv2") as memory:
        for query, vector in zip(corpus["queries"], query_vectors):
            tick = time.perf_counter_ns()
            hits, engine = find(memory, query["text"], vector, manifest, vectors)
            native_samples.append((time.perf_counter_ns() - tick) / 1_000_000)
            rows.append({**query, "hits": hits, "requested_mode": "sem", "native_engine": engine})
    return {"model": model, "queries": rows, "metrics": summarize(rows), "by_category": metrics_by_category(rows),
            "source_manifest": manifest, "graph": encoder.graph, "assets": encoder.asset_manifest,
            "document_vectors": pack_vectors(list(vectors.values()), list(vectors)),
            "query_vectors": pack_vectors(query_vectors, [q["id"] for q in corpus["queries"]]),
            "encoder_load_seconds": loaded, "costs": costs, "query_encode_seconds": query_encode_seconds,
            "native_query_samples_ms": native_samples, "native_query_p50_ms": percentile(native_samples, .5),
            "native_query_p95_ms": percentile(native_samples, .95),
            "native_timing_scope": "native sem search + source verification, excludes batch query encode and file open; one sample/query",
            "memory_sha256": digest(output / "notes.mv2")}


def evaluate_policy(rows, policy):
    decisions, costs = [], []
    for row in rows:
        started = time.perf_counter_ns()
        result = decide(row["hits"], policy)
        costs.append((time.perf_counter_ns() - started) / 1_000_000)
        decisions.append({"query_id": row["id"], **result})
    groups = {category: [r for r in rows if r["category"] == category] for category in (*POSITIVE, "unanswerable")}
    groups.update({kind: [r for r in rows if r.get("negative_type") == kind] for kind in NEGATIVE})
    return {"metrics": summarize_decisions(rows, policy), "decisions": decisions,
            "by_category": {name: summarize_decisions(subset, policy) for name, subset in groups.items()},
            "decision_samples_ms": costs, "decision_p50_ms": percentile(costs, .5), "decision_p95_ms": percentile(costs, .95),
            "timing_scope": "policy validation + all raw hit validation/dedup + decision; excludes encoder/native search; one sample/query on shared CPU"}


def adoption(result, update, enabled, raw_integrity):
    metrics = result["metrics"]
    checks = {"enabled": enabled, "hit_rate": metrics["answerable_hit_rate"] is not None and metrics["answerable_hit_rate"] >= .9,
              "mrr": metrics["mrr_at_1"] is not None and metrics["mrr_at_1"] >= .8,
              "precision": metrics["source_precision"] is not None and metrics["source_precision"] >= .8,
              "unknown_false_return": metrics["unknown_false_return_rate"] == 0,
              "raw_source_integrity": raw_integrity == 1,
              "updates": update is not None and all(update.get(key) is True for key in ("current_view_passed", "deleted_absent", "new_process_reopen"))}
    return {"checks": checks, "recommendation": "candidate_for_further_trial" if all(checks.values()) else "do_not_adopt_directly",
            "failed_criteria": [key for key, passed in checks.items() if not passed]}


def runtime_setup(cache):
    from offline import local_environment, deny_network
    local_environment()
    network = deny_network()
    assets = verify_assets(cache)
    from semantic_sdk import activate
    patched = activate()
    import memvid_sdk as sdk
    if importlib.metadata.version("memvid-sdk") != "2.0.160" or sdk.info()["native"]["memvid_core_version"] != "2.0.140":
        raise ValueError("Unexpected SDK/core version")
    return network, assets, patched


def run(args):
    if args.output.exists() or args.output.is_symlink():
        raise FileExistsError("Output already exists; not overwritten")
    load_corpora(args.dev, args.heldout)
    network, assets, patched = runtime_setup(args.cache)
    args.output.mkdir(parents=True, exist_ok=False)
    output = args.output.resolve()
    source_names = ("rejection_eval.py", "rejection_policy.py", "semantic_eval.py", "semantic_models.py", "semantic_sdk.py", "prepare_semantic_sdk.py", "semantic-sdk.patch", "semantic-sdk-lock.patch", "notes_eval.py", "scenarios.py", "models.py", "offline.py", "requirements.lock", "requirements-models.lock", "docs/notes-rejection.md")
    report = {"schema_version": 1, "started_at": now(), "evaluation_completed": False, "freeze_commit": FREEZE_COMMIT,
              "corpora": {split: FROZEN[split] for split in ("dev", "heldout")}, "network": network, "assets": assets,
              "patched_sdk": patched, "models": MODELS, "sources": {name: digest(ROOT / name) for name in source_names},
              "versions": {name: importlib.metadata.version(name) for name in ("memvid-sdk", "numpy", "onnxruntime", "tokenizers")},
              "quality": [], "updates": [], "evaluations": [], "errors": [], "primary": None,
              "measurement_conditions": "Synthetic fixed split24notes/48queries each; shared CPU, no population/production guarantee"}
    write_json(output / "report.json", report)

    def job(kind, model, split):
        destination = output / f"{model}-{kind}-{split}"
        destination.mkdir()
        path = args.dev if split == "dev" else args.heldout
        began = now()
        tick = time.perf_counter()
        try:
            process = subprocess.run([sys.executable, str(ROOT / "rejection_eval.py"), "_worker", kind, str(destination),
                                      str(path.resolve()), split, model, str(args.cache.resolve())], capture_output=True, text=True, timeout=300)
            if process.returncode:
                raise RuntimeError(f"Worker exit{process.returncode}: " + process.stderr[-1800:])
            result = {**json.loads(process.stdout), "split": split, "started_at": began, "completed_at": now(), "worker_elapsed_seconds": time.perf_counter() - tick}
            if kind == "quality":
                if result["metrics"]["source_integrity"] != 1 or len(result["queries"]) != 48 or result["costs"]["note_count"] != 24:
                    raise ValueError("Raw source/count integrity failed or no actual hits")
                for row in result["queries"]:
                    features(row["hits"])
                result["native_top1_metrics"] = native_top1_metrics(result["queries"])
                result["m3_raw_metrics_scope"] = "Inherited raw@5 metrics are descriptive only; M4 decisions use single-gold top1 metrics"
            report[kind].append(result)
            write_json(output / "report.json", report)
            return result
        except (subprocess.TimeoutExpired, RuntimeError, ValueError, KeyError, TypeError) as error:
            message = re.sub(r"/(?:home|tmp|opt)/[^\s]+", "<local-path>", str(error))
            report["errors"].append({"kind": kind, "model": model, "split": split, "error": message})
            write_json(output / "report.json", report)
            return None

    development = {model: job("quality", model, "dev") for model in MODEL_ORDER}
    if all(development.values()) and not report["errors"]:
        tick = time.perf_counter()
        records = [{"model": model, **calibrate(development[model]["queries"], family)} for model in MODEL_ORDER for family in FAMILIES]
        primary = select_primary(records)
        calibration = {"source_split": "dev", "created_at": now(), "corpus_sha256": FROZEN["dev"], "protocol_sha256": FROZEN["protocol"],
                       "primary": primary, "policies": records, "calibration_seconds": time.perf_counter() - tick}
        write_json(output / "calibration.json", calibration)
        report.update(calibration_sha256=digest(output / "calibration.json"), calibration_created_at=calibration["created_at"], primary=primary,
                      calibration_seconds=calibration["calibration_seconds"], selected_policies=[{k: v for k, v in r.items() if k not in ("candidates", "candidate_columns")} for r in records])
        write_json(output / "report.json", report)
        for model in MODEL_ORDER:
            report.setdefault("heldout_started_at", now())
            heldout = job("quality", model, "heldout")
            for split, raw in (("dev", development[model]), ("heldout", heldout)):
                if raw is None:
                    continue
                for record in [r for r in records if r["model"] == model]:
                    report["evaluations"].append({"model": model, "family": record["family"], "split": split,
                                                  "policy": record["policy"], **evaluate_policy(raw["queries"], record["policy"])})
            if digest(output / "calibration.json") != report["calibration_sha256"]:
                raise ValueError("Calibration changed after heldout began")
            job("updates", model, "dev")
        if not report["errors"]:
            report["decisions"] = []
            for result in [r for r in report["evaluations"] if r["split"] == "heldout"]:
                update = next(u for u in report["updates"] if u["model"] == result["model"])
                raw = next(q for q in report["quality"] if q["model"] == result["model"] and q["split"] == "heldout")
                report["decisions"].append({"model": result["model"], "family": result["family"], **adoption(result, update, result["policy"]["enabled"], raw["metrics"]["source_integrity"])})
            report["primary_decision"] = next((d for d in report["decisions"] if d["model"] == primary["model"] and d["family"] == primary["family"]),
                                              {"recommendation": "do_not_adopt_directly", "failed_criteria": ["no_feasible_primary"]})
            report["evaluation_completed"] = len(report["quality"]) == 4 and len(report["updates"]) == 2 and len(report["evaluations"]) == 8
    report["ended_at"] = now()
    write_json(output / "report.json", report)
    print(json.dumps({"evaluation_completed": report["evaluation_completed"], "primary": report["primary"], "decision": report.get("primary_decision"), "errors": report["errors"]}, ensure_ascii=False))
    return 0 if report["evaluation_completed"] else 1


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "_worker":
        _, _, kind, directory, corpus_path, split, model, cache = sys.argv
        if model not in MODEL_ORDER or kind not in ("quality", "updates") or split not in ("dev", "heldout"):
            raise ValueError("Invalid worker configuration")
        if digest(Path(corpus_path)) != FROZEN[split]:
            raise ValueError("Worker corpus differs from freeze")
        corpus = validate_corpus(json.loads(Path(corpus_path).read_text()), split)
        network, assets, patched = runtime_setup(Path(cache))
        result = quality(Path(directory), corpus, model, Path(cache)) if kind == "quality" else updates(Path(directory), model, Path(cache))
        print(json.dumps({**result, "network": network, "patched_sdk": patched}, ensure_ascii=False, allow_nan=False))
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run",))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=ROOT / "work/semantic-models")
    parser.add_argument("--dev", type=Path, default=ROOT / "fixtures/notes-rejection-dev.json")
    parser.add_argument("--heldout", type=Path, default=ROOT / "fixtures/notes-rejection-heldout.json")
    args = parser.parse_args()
    try:
        return run(args)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"Rejection evaluation failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
