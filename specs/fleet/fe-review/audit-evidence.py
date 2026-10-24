#!/usr/bin/env python3
"""Read-only union audit: retain eleven green originals, replace only service/mobile."""
import hashlib
import json
from pathlib import Path
import struct
import sys

SIZES = {"desktop": (1440, 900), "tablet": (834, 1112), "mobile": (390, 844)}
PAGES = {"login", "catalog", "node", "service"}
EXPECTED = {(page, size, "light") for page in PAGES for size in SIZES}
REPLACE = ("service", "mobile", "light")


def check(ok, reason):
    if not ok:
        raise ValueError(reason)


def indexed(records, expected):
    result = {}
    for record in records:
        key = (record.get("page"), record.get("viewport"), record.get("colorScheme"))
        check(key in expected and key not in result, "unexpected or duplicate matrix key")
        result[key] = record
    check(set(result) == expected, "missing matrix key")
    return result


def artifact(run, record, selected):
    file = (run / "matrix" / record["screenshot"]).resolve()
    check(file.is_relative_to((run / "matrix/screenshots").resolve()), "screenshot escaped owned directory")
    data = file.read_bytes()
    check(data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    if selected:
        expected = SIZES[record["viewport"]]
        check(width == expected[0] and height >= expected[1], "PNG dimensions disagree with viewport")
        check(record.get("status") == 200 and not record.get("error") and record.get("horizontalOverflow") is False, "selected capture failed")
        check(record.get("pageErrors") == [] and record.get("consoleErrors") == [] and record.get("failedRequests") == [], "selected static capture has health issues")
    return {"key": "/".join((record["page"], record["viewport"], record["colorScheme"])), "run": run.name, "screenshot": record["screenshot"], "width": width, "height": height, "sha256": hashlib.sha256(data).hexdigest(), "selected": selected}


def audit(original, replacement):
    old = json.loads((original / "matrix/capture.json").read_text())
    new = json.loads((replacement / "matrix/capture.json").read_text())
    originals = indexed(old["results"], EXPECTED)
    replacements = indexed(new["results"], {REPLACE})
    check(originals[REPLACE]["horizontalOverflow"] is True, "original failure was not preserved")
    # Meaningful canaries: neither duplicates nor an omitted key can pass this audit.
    for invalid in [old["results"] + [old["results"][0]], old["results"][:-1]]:
        try:
            indexed(invalid, EXPECTED)
        except ValueError:
            continue
        raise ValueError("union guard canary unexpectedly accepted")
    selected = [artifact(original, record, True) for key, record in originals.items() if key != REPLACE]
    selected.append(artifact(replacement, replacements[REPLACE], True))
    failed = artifact(original, originals[REPLACE], False)
    before = json.loads((original / "result.json").read_text())
    after = json.loads((replacement / "result.json").read_text())
    required = {"CATALOG_KEYBOARD", "CATALOG_POLL", "BUSY", "SERVICE_ACTIONS", "ROLLBACK", "ERROR_ALERT", "EMPTY_STATES", "EMPTY_CATALOG", "LOGIN"}
    check(required <= {step["stage"] for step in before["steps"] if step["passed"]}, "accepted interaction evidence incomplete")
    check(before["error"] == "REVIEW_CAPTURE_ORACLE" and before["cleanupPassed"] is True, "original attempt boundary changed")
    check(after["passed"] is True and after["cleanupPassed"] is True, "repair or cleanup failed")
    check({(record["page"], record["viewport"]) for record in after["loaded"]} == {(p, v) for p in PAGES for v in SIZES} and len(after["loaded"]) == 12, "loaded guard inventory mismatch")
    check(all(r["status"] == 200 and r["finalPathMatches"] and r["identity"] and not r["overflow"] for r in after["loaded"]), "loaded guard failed")
    check(len(after["axe"]) == 4 and {r["page"] for r in after["axe"]} == PAGES, "axe inventory mismatch")
    product = [key for key in before["sourceHashes"] if key.startswith("internal/")]
    changed = [key for key in product if before["sourceHashes"][key] != after["sourceHashes"][key]]
    check(changed == ["internal/ui/static/app.css"], "unexpected product delta after accepted flow")
    return {"selectedCount": len(selected), "replacementOnly": "/".join(REPLACE), "selected": selected, "originalFailedArtifact": failed, "unionNegativeCanariesPassed": 2, "productDeltaAfterAcceptedFlow": changed, "interactionRun": original.name, "remainingRun": replacement.name, "loaded": 12, "axeScans": 4, "axeFindings": after["axe"], "cleanup": {original.name: before["cleanup"], replacement.name: after["cleanup"]}, "limits": ["11 original PNGs precede the one-property CSS containment repair", "12 loaded guards and 4 axe scans use final CSS binary", "fresh repair synthetic IDs, generation and timestamps differ", "full R3 and CF OTP unverified"]}


if __name__ == "__main__":
    print(json.dumps(audit(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
