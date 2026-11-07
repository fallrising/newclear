"""Fixed M4 query-level rejection. Pure policy code never receives gold labels."""
from __future__ import annotations

import math

GRID = tuple(i / 100 for i in range(101))
FAMILIES = ("score_only", "score_margin")
MODEL_ORDER = ("bge_zh", "e5_multi")
CANDIDATE_COLUMNS = ("threshold_step", "margin_step", "correct", "returned", "wrong_source", "unknown_false_return", "feasible")


def validate_policy(policy):
    if not isinstance(policy, dict) or policy.get("family") not in FAMILIES or type(policy.get("enabled")) is not bool:
        raise ValueError("Invalid policy family or enabled flag")
    for key in ("threshold", "margin"):
        value = policy.get(key)
        if type(value) not in (int, float) or not math.isfinite(value) or value not in GRID:
            raise ValueError("Policy thresholds must use the fixed finite grid")
    if policy["family"] == "score_only" and policy["margin"] != 0:
        raise ValueError("Score-only policy must use zero margin")
    return policy


def features(hits):
    if not isinstance(hits, list):
        raise ValueError("Expected native hit list")
    distinct, seen, frames = [], set(), {}
    for hit in hits:
        if not isinstance(hit, dict):
            raise ValueError("Invalid native hit")
        uri, frame, score = hit.get("uri"), hit.get("frame_id"), hit.get("cosine")
        if (not isinstance(uri, str) or not uri.strip() or type(frame) is not int or frame < 0
                or type(score) not in (int, float) or not math.isfinite(score) or not -1 <= score <= 1
                or hit.get("integrity_ok") is not True):
            raise ValueError("Invalid source or cosine in raw native hit")
        if frame in frames and frames[frame] != uri:
            raise ValueError("One frame cannot identify different sources")
        frames[frame] = uri
        if uri not in seen:
            seen.add(uri)
            distinct.append(hit)
    return {"top": distinct[0] if distinct else None, "score": distinct[0]["cosine"] if distinct else None,
            "margin": distinct[0]["cosine"] - distinct[1]["cosine"] if len(distinct) >= 2 else None,
            "distinct_count": len(distinct)}


def _reason(feature, policy):
    if not policy["enabled"]:
        return "disabled_policy"
    if feature["top"] is None:
        return "no_candidates"
    if policy["family"] == "score_margin" and feature["margin"] is None:
        return "insufficient_candidates"
    if feature["score"] < policy["threshold"]:
        return "below_score"
    if policy["family"] == "score_margin" and feature["margin"] < policy["margin"]:
        return "below_margin"
    return "accepted"


def decide(hits, policy):
    validate_policy(policy)
    feature = features(hits)  # All raw evidence is validated before dedup/disabled/early return.
    reason = _reason(feature, policy)
    top = feature["top"] if reason == "accepted" else None
    return {"decision": "accept" if top else "abstain", "reason": reason,
            "score": feature["score"], "margin": feature["margin"], "distinct_count": feature["distinct_count"],
            "returned_uris": [top["uri"]] if top else [], "returned_frame_ids": [top["frame_id"]] if top else []}


def _prepared(rows):
    result, ids = [], set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or row["id"] in ids:
            raise ValueError("Invalid or duplicate query identity")
        ids.add(row["id"])
        gold = row.get("relevant_uris")
        if not isinstance(gold, list) or len(gold) > 1 or any(not isinstance(uri, str) or not uri for uri in gold):
            raise ValueError("M4 requires zero or one gold source")
        result.append((features(row.get("hits")), gold[0] if gold else None))
    return result


def _counts(prepared, policy):
    correct = returned = wrong = unknown_false = 0
    for feature, gold in prepared:
        if _reason(feature, policy) != "accepted":
            continue
        returned += 1
        uri = feature["top"]["uri"]
        correct += gold is not None and uri == gold
        wrong += gold is not None and uri != gold
        unknown_false += gold is None
    return int(correct), returned, int(wrong), int(unknown_false)


def _metrics(prepared, counts):
    correct, returned, wrong, unknown_false = counts
    total = len(prepared)
    answerable = sum(gold is not None for _, gold in prepared)
    unknown = total - answerable
    return {"query_count": total, "answerable_count": answerable, "unknown_count": unknown,
            "correct_count": correct, "returned_count": returned, "wrong_source_count": wrong,
            "unknown_false_return_count": unknown_false, "abstained_count": total - returned,
            "answerable_hit_rate": correct / answerable if answerable else None,
            "mrr_at_1": correct / answerable if answerable else None,
            "source_precision": correct / returned if returned else None,
            "unknown_false_return_rate": unknown_false / unknown if unknown else None,
            "abstention_rate": (total - returned) / total if total else None}


def summarize_decisions(rows, policy):
    validate_policy(policy)
    prepared = _prepared(rows)
    return _metrics(prepared, _counts(prepared, policy))


def calibrate(dev_rows, family):
    if family not in FAMILIES:
        raise ValueError("Unknown family")
    prepared = _prepared(dev_rows)
    if not any(gold for _, gold in prepared) or not any(gold is None for _, gold in prepared):
        raise ValueError("Calibration needs answerable and unanswerable development queries")
    candidates, best, best_key = [], None, None
    for t, threshold in enumerate(GRID):
        for g, margin in enumerate(GRID if family == "score_margin" else (0.0,)):
            policy = {"family": family, "threshold": threshold, "margin": margin, "enabled": True}
            counts = _counts(prepared, policy)
            correct, returned, wrong, unknown_false = counts
            feasible = returned > 0 and correct == returned and unknown_false == 0
            candidates.append([t, g, correct, returned, wrong, unknown_false, feasible])
            key = (correct, t, g)
            if feasible and (best_key is None or key > best_key):
                best, best_key = policy, key
    enabled = best is not None
    policy = best or {"family": family, "threshold": 1.0, "margin": 0.0, "enabled": False}
    return {"family": family, "source_split": "dev", "selection_status": "feasible" if enabled else "no_feasible_policy",
            "policy": policy, "metrics": _metrics(prepared, _counts(prepared, policy)),
            "candidate_columns": list(CANDIDATE_COLUMNS), "candidates": candidates}


def select_primary(records):
    if len({(r["model"], r["family"]) for r in records}) != len(records):
        raise ValueError("Duplicate model/family candidate")
    eligible = []
    for record in records:
        if record["model"] not in MODEL_ORDER or record["family"] not in FAMILIES:
            raise ValueError("Unexpected model/family")
        validate_policy(record["policy"])
        if record["policy"]["family"] != record["family"]:
            raise ValueError("Policy family mismatch")
        if record["policy"]["enabled"]:
            eligible.append(record)
    if not eligible:
        return {"model": None, "family": None, "enabled": False}
    chosen = max(eligible, key=lambda r: (r["metrics"]["correct_count"], -FAMILIES.index(r["family"]), -MODEL_ORDER.index(r["model"])))
    return {"model": chosen["model"], "family": chosen["family"], "enabled": True}


def native_top1_metrics(rows):
    prepared = _prepared(rows)
    correct = returned = wrong = unknown_false = 0
    for feature, gold in prepared:
        if feature["top"] is None:
            continue
        returned += 1
        correct += gold is not None and feature["top"]["uri"] == gold
        wrong += gold is not None and feature["top"]["uri"] != gold
        unknown_false += gold is None
    return _metrics(prepared, (int(correct), returned, int(wrong), int(unknown_false)))
