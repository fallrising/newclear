"""Real offline BGE and native MobileCLIP runs with content-based oracles."""

from __future__ import annotations

import os
from pathlib import Path
import shutil

from models import BGE_REVISION, CLIP_REVISION, sha256_file, verify_assets


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def _local_environment(cache: Path) -> None:
    # Never inherit cloud credentials into SDK auto-detection or usage tracking.
    for name in ("OPENAI_API_KEY", "MEMVID_API_KEY", "COHERE_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"):
        os.environ.pop(name, None)
    os.environ["MEMVID_TELEMETRY"] = "0"
    os.environ["MEMVID_OFFLINE"] = "1"
    os.environ["MEMVID_MODELS_DIR"] = str(cache)
    os.environ["MEMVID_CLIP_MODEL"] = "mobileclip-s2"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"


def _new_memory(output: Path, filename: str):
    from memvid_sdk import create

    path = output / filename
    if path.exists() or path.is_symlink():
        raise FileExistsError(f"Refusing to overwrite memory: {filename}")
    output.mkdir(parents=True, exist_ok=True)
    return create(str(path), enable_vec=True), path


def _hits(result: dict) -> list[dict]:
    return [{"uri": h["uri"], "frame_id": h["frame_id"], "score": h["score"]} for h in result["hits"]]


def _verify_memory(mem) -> dict:
    result = mem.verify(deep=True)
    _require(result.get("overall_status") == "passed", "Memory integrity verification failed")
    return {"overall_status": result["overall_status"], "checks": result["checks"]}


class BgeLocal:
    """BAAI's pinned ONNX model, CLS pooling and L2-normalized embeddings.

    Uses only explicit file paths; no hub or network loader is involved. BGE's
    retrieval instruction is applied to queries, never to document passages.
    """

    def __init__(self, cache: Path):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        ort.disable_telemetry_events()
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(
            str(cache / "bge-small-en-v1.5/model.onnx"),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.tokenizer = Tokenizer.from_file(str(cache / "bge-small-en-v1.5/tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding()

    def encode(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        import numpy as np

        if query:
            texts = ["Represent this sentence for searching relevant passages: " + text for text in texts]
        tokens = self.tokenizer.encode_batch(texts)
        attributes = {"input_ids": "ids", "attention_mask": "attention_mask", "token_type_ids": "type_ids"}
        inputs = {
            entry.name: np.asarray([getattr(token, attributes[entry.name]) for token in tokens], dtype=np.int64)
            for entry in self.session.get_inputs()
        }
        # The pinned model exposes last_hidden_state: [batch, sequence, 384].
        vectors = self.session.run(["last_hidden_state"], inputs)[0][:, 0, :]
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        _require(bool(np.all(np.isfinite(vectors)) and np.all(norms > 0)), "Invalid BGE embeddings")
        vectors = vectors / norms
        _require(vectors.shape == (len(texts), 384), "Unexpected BGE embedding dimensions")
        return vectors.tolist()


def run_semantic(output: Path, cache: Path) -> dict:
    output, cache = Path(output), Path(cache)
    assets = verify_assets(cache, "semantic")
    _local_environment(cache)
    from memvid_sdk import use

    encoder = BgeLocal(cache)
    passages = [
        "A physician examined the infant at the pediatric clinic.",
        "The mechanic replaced a broken engine in the vehicle.",
        "A musician performed a classical piano concerto.",
    ]
    docs = [{"title": f"Document {i}", "label": "passage", "text": text, "uri": f"mv2://semantic/{i}"}
            for i, text in enumerate(passages)]
    vectors = encoder.encode(passages)
    mem, path = _new_memory(output, "semantic.mv2")
    queries = []
    try:
        ids = mem.put_many(
            docs, embeddings=vectors,
            embedding_identity={"provider": "local-onnx", "model": "BAAI/bge-small-en-v1.5", "dimension": 384, "normalized": True},
            opts={"enable_embedding": False, "auto_tag": False, "extract_dates": False},
        )
        _require(len(ids) == 3, "Expected three indexed passages")
        for text, expected in (("A doctor checking a baby", "mv2://semantic/0"),
                               ("automobile repair garage", "mv2://semantic/1")):
            lexical = mem.find(text, mode="lex", k=3)
            _require(not lexical["hits"], "Semantic control query unexpectedly had lexical hits")
            vector = encoder.encode([text], query=True)[0]
            result = mem.find(text, mode="sem", query_embedding=vector, k=3)
            _require(bool(result["hits"]) and result["hits"][0]["uri"] == expected,
                     f"Semantic retrieval did not rank {expected} first")
            queries.append({"query": text, "expected_uri": expected, "requested_mode": "sem",
                            "engine": result.get("engine"), "lexical_control_hits": 0, "hits": _hits(result)})
        text = "pediatric clinic"
        lexical = mem.find(text, mode="lex", k=3)
        result = mem.find(text, mode="auto", query_embedding=encoder.encode([text], query=True)[0], k=3)
        _require(bool(lexical["hits"]) and lexical["hits"][0]["uri"] == "mv2://semantic/0",
                 "Expected lexical evidence for the mixed retrieval query")
        _require(bool(result["hits"]) and result["hits"][0]["uri"] == "mv2://semantic/0",
                 "Mixed retrieval did not rank the expected passage first")
        queries.append({"query": text, "expected_uri": "mv2://semantic/0", "requested_mode": "auto",
                        "engine": result.get("engine"), "lexical_hits": _hits(lexical), "hits": _hits(result)})
        mem.seal()
        verification = _verify_memory(mem)
    finally:
        mem.close()
    with use("basic", str(path), read_only=True) as reopened:
        result = reopened.find(queries[0]["query"], mode="sem", query_embedding=encoder.encode([queries[0]["query"]], query=True)[0], k=1)
        _require(result["hits"][0]["uri"] == queries[0]["expected_uri"], "Vector persistence failed on reopen")
    return {"model": "BAAI/bge-small-en-v1.5", "revision": BGE_REVISION, "dimension": 384,
            "provider": "local ONNX Runtime CPU; supplied to the real Memvid vector index",
            "assets": assets, "queries": queries, "reopen_verified": True, "verification": verification,
            "memory": {"path": path.name, "sha256": sha256_file(path)},
            "scope": "Records both requested mode and native engine label; does not infer a scoring formula from the label."}


def run_clip(output: Path, cache: Path) -> dict:
    output, cache = Path(output), Path(cache)
    assets = verify_assets(cache, "clip")
    _local_environment(cache)
    from memvid_sdk.clip import LocalClip
    from memvid_sdk import use

    output.mkdir(parents=True, exist_ok=True)
    images_dir = output / "clip-inputs"
    images_dir.mkdir(exist_ok=False)
    inputs = []
    for i, source in enumerate(("astronaut.png", "coffee.png")):
        destination = images_dir / f"asset-{i}.png"
        shutil.copyfile(cache / "images" / source, destination)
        inputs.append(destination)
    encoder = LocalClip("mobileclip-s2")
    vectors = [encoder.embed_image(str(path)) for path in inputs]
    _require(all(len(vector) == 512 for vector in vectors), "Unexpected CLIP embedding dimensions")
    docs = [{"title": f"Image {i}", "label": "asset", "text": f"Opaque asset {i}", "uri": f"mv2://images/{i}"}
            for i in range(2)]
    # Captions, filenames and expected labels are deliberately not indexed.
    mem, path = _new_memory(output, "clip.mv2")
    queries = []
    try:
        mem.put_many(
            docs, embeddings=vectors,
            embedding_identity={"provider": "memvid-native-clip", "model": "mobileclip-s2", "dimension": 512, "normalized": True},
            opts={"enable_embedding": False, "auto_tag": False, "extract_dates": False},
        )
        for text, expected_index in (("a photograph of an astronaut in a spacesuit", 0),
                                     ("a cup of coffee on a wooden table", 1)):
            vector = encoder.embed_text(text)
            _require(len(vector) == 512, "Unexpected CLIP query dimensions")
            similarities = [sum(a * b for a, b in zip(vector, image_vector)) for image_vector in vectors]
            _require(similarities[expected_index] > similarities[1 - expected_index] + 0.05,
                     "CLIP model did not distinguish the expected image from its distractor")
            lexical = mem.find(text, mode="lex", k=2)
            _require(not lexical["hits"], "Image result must not be explained by indexed captions")
            result = mem.find(text, mode="sem", query_embedding=vector, k=2)
            expected = f"mv2://images/{expected_index}"
            _require(bool(result["hits"]) and result["hits"][0]["uri"] == expected,
                     f"Image retrieval did not rank {expected} first")
            queries.append({"query": text, "expected_uri": expected, "requested_mode": "sem",
                            "engine": result.get("engine"), "lexical_control_hits": 0,
                            "model_cosine_similarities": similarities, "hits": _hits(result)})
        mem.seal()
        verification = _verify_memory(mem)
    finally:
        mem.close()
    with use("basic", str(path), read_only=True) as reopened:
        result = reopened.find(queries[1]["query"], mode="sem", query_embedding=encoder.embed_text(queries[1]["query"]), k=1)
        _require(result["hits"][0]["uri"] == queries[1]["expected_uri"], "CLIP vector persistence failed on reopen")
    return {"model": "mobileclip-s2", "revision": CLIP_REVISION, "dimension": 512,
            "provider": "Memvid native ClipModel image and text encoders", "assets": assets,
            "queries": queries, "reopen_verified": True, "verification": verification,
            "memory": {"path": path.name, "sha256": sha256_file(path)},
            "images": [{"path": str(p.relative_to(output)), "sha256": sha256_file(p)} for p in inputs],
            "scope": "Real native CLIP embeddings use the SDK's public put_many vector interface. Original PNGs remain separate fixtures; the SDK does not expose the Rust CLIP-track insertion API."}
