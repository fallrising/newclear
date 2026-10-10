"""Validate persisted patch bytes without interpreting or modifying their content."""

import hashlib
import re

from .domain import Problem

DIFF_LIMIT = 256 * 1024
DOWNLOAD_CSP = "sandbox; default-src 'none'"


def diff_bytes(run):
    result = run.get("result")
    if result is None or (isinstance(result, dict) and "diff" not in result):
        raise Problem(404, "result_diff_not_found")
    if not isinstance(result, dict) or not isinstance(result["diff"], str):
        raise Problem(409, "result_diff_invalid")
    diff = result["diff"]
    # Bound work before encoding. Every UTF-8 code point needs at least one byte.
    if len(diff) > DIFF_LIMIT:
        raise Problem(409, "result_diff_invalid")
    try:
        patch = diff.encode("utf-8")
    except UnicodeError:
        raise Problem(409, "result_diff_invalid") from None
    count, digest, base = (result.get(key) for key in ("diff_bytes", "diff_sha256", "base_sha"))
    if (
        len(patch) > DIFF_LIMIT
        or type(count) is not int
        or count != len(patch)
        or not isinstance(digest, str)
        or re.fullmatch(r"[a-f0-9]{64}", digest) is None
        or digest != hashlib.sha256(patch).hexdigest()
        or not isinstance(base, str)
        or re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", base) is None
        or base != run["base_sha"]
    ):
        raise Problem(409, "result_diff_invalid")
    return patch
