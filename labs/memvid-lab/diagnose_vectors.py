#!/usr/bin/env python3
"""Reproduce M3's fixed-SDK batch/vector persistence blocker; FAIL exits nonzero."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import sys
from notes_eval import digest, FROZEN_CORPUS_SHA256, validate_corpus, write_json
from semantic_models import LocalEncoder, MODELS, verify_assets


def run(cache, output, *, patched=False):
    if output.exists() or output.is_symlink():
        raise FileExistsError("Output already exists; not overwritten")
    root = Path(__file__).resolve().parent
    corpus_path = root / "fixtures/notes.json"
    if digest(corpus_path) != FROZEN_CORPUS_SHA256:
        raise ValueError("Development corpus differs from frozen bytes")
    corpus = validate_corpus(json.loads(corpus_path.read_text()))
    from offline import local_environment, deny_network
    local_environment()
    network = deny_network()
    patch_manifest = None
    if patched:
        from semantic_sdk import activate
        patch_manifest = activate()
    verify_assets(cache, "bge_zh")
    encoder = LocalEncoder(cache, "bge_zh")
    import memvid_sdk as sdk
    sdk_version = importlib.metadata.version("memvid-sdk")
    core_version = sdk.info()["native"]["memvid_core_version"]
    if sdk_version != "2.0.160" or core_version != "2.0.140":
        raise ValueError("Diagnostic requires pinned SDK2.0.160/core2.0.140")
    output.mkdir(parents=True, exist_ok=False)
    docs = [{"title": n["title"], "text": n["title"] + "\n" + n["text"], "uri": n["uri"],
             "label": "fixture", "metadata": {"fixture": "synthetic"}, "timestamp": 1700000000}
            for n in corpus["notes"]]
    vectors = encoder.encode([d["text"] for d in docs])
    text = corpus["queries"][0]["text"]
    query = encoder.encode([text], query=True)[0]
    memory = sdk.create(str(output / "probe.mv2"), enable_vec=True, enable_lex=True)

    def observe(mem):
        result = mem.find(text, mode="sem", query_embedding=query, k=24, snippet_chars=8000)
        return {"frames": {d["uri"]: int(mem.frame(d["uri"])["id"]) for d in docs},
                "hits": [{"frame_id": h["frame_id"], "uri": h["uri"], "score": h["score"]} for h in result["hits"]]}

    try:
        ids = memory.put_many(docs, embeddings=vectors,
                              embedding_identity={"provider": "local-onnx", "model": MODELS["bge_zh"]["repository"],
                                                  "dimension": 512, "normalized": True},
                              opts={"enable_embedding": False, "auto_tag": False, "extract_dates": False,
                                    "disable_auto_checkpoint": True})
        before = observe(memory)
        memory.seal()
    finally:
        memory.close()
    with sdk.use("basic", str(output / "probe.mv2"), read_only=True) as reopened:
        after = observe(reopened)
    expected = set(after["frames"])
    observed = {h["uri"] for h in after["hits"]}
    ids_match = all(int(i) == after["frames"][d["uri"]] for i, d in zip(ids, docs))
    passed = len(ids) == len(docs) and ids_match and observed == expected
    report = {"schema_version": 1, "sdk": sdk_version, "core": core_version,
              "model": "bge_zh", "model_revision": MODELS["bge_zh"]["revision"],
              "corpus_sha256": digest(corpus_path), "expected_source_count": len(docs),
              "put_many_ids": ids, "before_seal": before, "after_reopen": after,
              "returned_ids_match_persisted_frames": ids_match, "all_sources_searchable_after_reopen": observed == expected,
              "native_persistence_passed": passed, "network": network,
              "sources": {n: digest(root / n) for n in ("diagnose_vectors.py", "semantic_models.py", "requirements.lock", "requirements-models.lock")}}
    if patch_manifest is not None:
        report["patched_sdk"] = patch_manifest
    write_json(output / "report.json", report)
    print(json.dumps({"native_persistence_passed": passed, "returned_ids_match": ids_match,
                      "before_count": len(before["hits"]), "after_count": len(after["hits"]), "expected": len(docs)}))
    return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        raise SystemExit(run(args.cache, args.output))
    except (OSError, ValueError) as error:
        print(f"Diagnostic failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(2)
