"""Pinned local CPU encoders for M3; only the explicit prepare command uses HTTP."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import tempfile
import urllib.request
from models import _asset_path, sha256_file

MODELS = {
    "bge_zh": {"repository": "Xenova/bge-small-zh-v1.5", "revision": "75c43b069aac4d136ba6bc1122f995fedcfd2781",
               "base_model": "BAAI/bge-small-zh-v1.5", "dimension": 512, "pooling": "cls", "pad_token": "[PAD]",
               "query_prefix": "为这个句子生成表示以用于检索相关文章：", "passage_prefix": "",
               "license": "Original BAAI model: MIT; exporter metadata has no separate declaration",
               "files": {"onnx/model.onnx": (94851877, "69a0b846f4f116b5e6aabf9546ea6754d02264f3211a13a1bd69b31b8040749a"),
                         "tokenizer.json": (439125, "48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26")}},
    "e5_multi": {"repository": "intfloat/multilingual-e5-small", "revision": "614241f622f53c4eeff9890bdc4f31cfecc418b3",
                 "base_model": "intfloat/multilingual-e5-small", "dimension": 384, "pooling": "mean", "pad_token": "<pad>",
                 "query_prefix": "query: ", "passage_prefix": "passage: ", "license": "MIT (official model)",
                 "files": {"onnx/model.onnx": (470268510, "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665"),
                           "tokenizer.json": (17082730, "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39")}},
}


def assets(model=None):
    names = [model] if model is not None else list(MODELS)
    return [{"model": name, "path": f"{name}/{relative}", "size_bytes": size, "sha256": digest,
             "revision": MODELS[name]["revision"], "license": MODELS[name]["license"],
             "url": f"https://huggingface.co/{MODELS[name]['repository']}/resolve/{MODELS[name]['revision']}/{relative}"}
            for name in names for relative, (size, digest) in MODELS[name]["files"].items()]


def check_file(path, asset):
    if not path.is_file():
        raise FileNotFoundError(f"Missing prepared semantic asset: {asset['path']}; run semantic_models.py prepare")
    if path.stat().st_size != asset["size_bytes"] or sha256_file(path) != asset["sha256"]:
        raise ValueError(f"Semantic asset checksum mismatch: {asset['path']}; existing bytes not replaced")


def verify_assets(cache, model=None):
    cache = Path(os.path.abspath(cache))
    manifest = assets(model)
    for asset in manifest:
        check_file(_asset_path(cache, asset["path"]), asset)
    return {"assets": manifest, "total_bytes": sum(a["size_bytes"] for a in manifest)}


def prepare(cache):
    cache = Path(os.path.abspath(cache))
    _asset_path(cache, "manifest.json")
    cache.mkdir(parents=True, exist_ok=True)
    for asset in assets():
        path = _asset_path(cache, asset["path"])
        if path.exists():
            check_file(path, asset)
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".download-", delete=False) as stream:
                temporary = Path(stream.name)
                request = urllib.request.Request(asset["url"], headers={"User-Agent": "memvid-lab/1"})
                with urllib.request.urlopen(request, timeout=120) as response:
                    received = 0
                    while block := response.read(1024 * 1024):
                        received += len(block)
                        if received > asset["size_bytes"]:
                            raise ValueError(f"Download exceeds pinned size: {asset['path']}")
                        stream.write(block)
            check_file(temporary, asset)
            os.link(temporary, path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    result = verify_assets(cache)
    target = cache / "manifest.json"
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if target.exists():
        if target.read_text() != encoded:
            raise ValueError("Existing semantic model manifest differs; not overwritten")
    else:
        with target.open("x") as stream:
            stream.write(encoded)
    return result


def prefixed_texts(model, texts, *, query):
    prefix = MODELS[model]["query_prefix" if query else "passage_prefix"]
    return [prefix + text for text in texts]


def pool_vectors(hidden, attention_mask, pooling, dimension):
    import numpy as np
    hidden = np.asarray(hidden)
    mask = np.asarray(attention_mask)
    if (hidden.ndim != 3 or hidden.shape[:2] != mask.shape or hidden.shape[2] != dimension
            or not np.all(np.isfinite(hidden)) or not np.all(np.isin(mask, [0, 1]))
            or not np.all(mask.sum(axis=1) > 0)):
        raise ValueError("Invalid model tensor/mask/dimension")
    if pooling == "cls":
        vectors = hidden[:, 0, :]
    elif pooling == "mean":
        vectors = (hidden * mask[:, :, None]).sum(axis=1) / mask.sum(axis=1)[:, None]
    else:
        raise ValueError("Unknown pooling")
    with np.errstate(over="ignore", invalid="ignore"):
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if not np.all(np.isfinite(vectors)) or not np.all(np.isfinite(norms)) or not np.all(norms > 0):
        raise ValueError("Invalid model vectors")
    normalized = (vectors / norms).astype(np.float32)
    if not np.all(np.isfinite(normalized)) or not np.allclose(np.linalg.norm(normalized, axis=1), 1, atol=1e-6):
        raise ValueError("Invalid normalized model vectors")
    return normalized


class LocalEncoder:
    def __init__(self, cache, model):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.model, self.config = model, MODELS[model]
        self.asset_manifest = verify_assets(cache, model)
        ort.disable_telemetry_events()
        options = ort.SessionOptions()
        options.intra_op_num_threads, options.inter_op_num_threads = 2, 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(str(Path(cache) / model / "onnx/model.onnx"),
                                           sess_options=options, providers=["CPUExecutionProvider"])
        self.inputs = self.session.get_inputs()
        self.outputs = self.session.get_outputs()
        if (not {i.name for i in self.inputs} <= {"input_ids", "attention_mask", "token_type_ids"}
                or not {"input_ids", "attention_mask"} <= {i.name for i in self.inputs}
                or any(i.type != "tensor(int64)" or len(i.shape) != 2 for i in self.inputs)):
            raise ValueError("Unexpected ONNX input contract")
        output = next((o for o in self.outputs if o.name == "last_hidden_state"), None)
        if output is None or output.type != "tensor(float)" or len(output.shape) != 3 or output.shape[2] != self.config["dimension"]:
            raise ValueError("Unexpected ONNX output contract")
        self.tokenizer = Tokenizer.from_file(str(Path(cache) / model / "tokenizer.json"))
        pad_id = self.tokenizer.token_to_id(self.config["pad_token"])
        if pad_id is None:
            raise ValueError("Missing model padding token")
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding(pad_id=pad_id, pad_token=self.config["pad_token"])
        self.graph = {"inputs": [{"name": x.name, "type": x.type, "shape": x.shape} for x in self.inputs],
                      "outputs": [{"name": x.name, "type": x.type, "shape": x.shape} for x in self.outputs],
                      "provider": self.session.get_providers(), "pad_id": pad_id, "max_tokens": 512,
                      "pooling": self.config["pooling"], "dimension": self.config["dimension"]}

    def encode(self, texts, *, query=False):
        import numpy as np
        if not texts or any(not isinstance(text, str) or not text.strip() for text in texts):
            raise ValueError("Expected nonempty input texts")
        result = []
        names = {"input_ids": "ids", "attention_mask": "attention_mask", "token_type_ids": "type_ids"}
        for offset in range(0, len(texts), 16):
            batch = prefixed_texts(self.model, texts[offset:offset + 16], query=query)
            tokens = self.tokenizer.encode_batch(batch)
            inputs = {entry.name: np.asarray([getattr(t, names[entry.name]) for t in tokens], dtype=np.int64)
                      for entry in self.inputs}
            hidden = self.session.run(["last_hidden_state"], inputs)[0]
            vectors = pool_vectors(hidden, inputs["attention_mask"], self.config["pooling"], self.config["dimension"])
            result.extend(vectors.tolist())
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "verify"))
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.cache) if args.command == "prepare" else verify_assets(args.cache), ensure_ascii=False))
