"""Check captured producer envelopes and receipts offline; never send or repair.

The existing contract checker supplies strict JSON, schema validation and JCS.
Alertmanager checks inspect retained inputs, not a second CloudEvents mapper.
The Go adapter and isolated HTTP integration remain the mapping authority.
"""
import argparse
import copy
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIRECTORY = ROOT / "examples/sources"
CONTRACT = SimpleNamespace(**runpy.run_path(str(ROOT / "contracts/check.py")))
API = CONTRACT.loads((ROOT / "contracts/openapi.json").read_text(encoding="utf-8"))
REQUIRED = ("config.json", "release.json", "inspection.json",
            "alertmanager-firing.json", "alertmanager-resolved.json")
NAMES = {"release", "inspection", "alertmanager"}
MAX_BODY_BYTES = 4 * 1024 * 1024


class SourceError(ValueError):
    """A capture cannot establish compatibility with current ingest contracts."""


def schema_check(schema, value, label):
    try:
        CONTRACT.Draft202012Validator(schema, format_checker=CONTRACT.FORMATS).validate(value)
    except CONTRACT.ValidationError:
        # Report location/category, never a private payload or credential path.
        raise SourceError(label + " invalid") from None


def read_capture(path):
    try:
        if path.stat().st_size > MAX_BODY_BYTES:
            raise SourceError("capture exceeds 4 MiB")
        document = CONTRACT.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        if isinstance(error, SourceError):
            raise
        raise SourceError("cannot read strict JSON capture") from None
    def check_depth(value, depth=1):
        if isinstance(value, (dict, list)):
            if depth > 64:
                raise SourceError("JSON nesting exceeds 64 levels")
            for item in value.values() if isinstance(value, dict) else value:
                check_depth(item, depth + 1)
    check_depth(document)
    return document


def policies(document):
    try:
        CONTRACT.validate("config", document)
    except (CONTRACT.ValidationError, ValueError):
        raise SourceError("invalid config contract") from None
    sources = {row["name"]: row for row in document["sources"]}
    if set(sources) != NAMES:
        raise SourceError("config requires the three configured names release, inspection, alertmanager")
    references = [row["token_ref"] for row in sources.values()]
    if len(set(references)) != len(references):
        raise SourceError("sources require distinct token_ref references")
    return sources


def authorize(policy, source, event_type):
    if (source.startswith("urn:signalhub:sources:") or event_type.startswith("signalhub.") or
            not source.startswith(policy["source_prefix"]) or
            not any(CONTRACT.matches(pattern, event_type) for pattern in policy["allowed_types"])):
        raise SourceError("forbidden source or type for capture's configured producer")


def remember(identities, key, content):
    previous = identities.get(key)
    if previous is not None:
        if previous != content:
            raise SourceError("immutable identity conflict; investigate 409, do not replace id")
        return True
    identities[key] = content
    return False


def check_event(document, policy, identities):
    try:
        CONTRACT.validate("event", document)
    except (CONTRACT.ValidationError, ValueError):
        raise SourceError("invalid CloudEvents contract") from None
    authorize(policy, document["source"], document["type"])
    return remember(identities, (document["source"], document["id"]), CONTRACT.canonical_event(document))


def check_alertmanager(document, policy, identities, warnings):
    # Validate envelope independently so invalid members retain their indices.
    envelope_schema = copy.deepcopy(API["components"]["schemas"]["AlertmanagerV4"])
    envelope_schema["properties"]["alerts"]["items"] = {}
    schema_check(envelope_schema, document, "Alertmanager envelope")
    if document.get("truncatedAlerts", 0) > 0:
        raise SourceError("truncated alerts cannot establish complete source acceptance")
    source = "urn:signalhub:alertmanager:" + document["receiver"]
    schema_check(CONTRACT.SCHEMAS["event"]["properties"]["source"], source, "mapped source")
    if not document["alerts"]:
        warnings.append("empty alerts produce no attributed delivery and cannot establish liveness")
    duplicates = 0
    errors = []
    for index, alert in enumerate(document["alerts"]):
        try:
            schema_check(API["components"]["schemas"]["AlertmanagerAlert"], alert, "alert")
            event_type = "alertmanager.alert." + alert["status"]
            authorize(policy, source, event_type)
            identity = alert["fingerprint"] + ":" + alert["startsAt"] + ":" + alert["status"]
            if len(identity) > 128:
                raise SourceError("mapped id length exceeds 128 characters")
            summary = alert["annotations"].get("summary") or alert["labels"].get("alertname", "")
            schema_check(CONTRACT.SCHEMAS["event"]["properties"]["summary"], summary, "mapped summary")
            retained_data = {"labels": alert["labels"], "annotations": alert["annotations"],
                             "groupKey": document["groupKey"]}
            if len(CONTRACT.rfc8785.dumps(retained_data)) > 16384:
                raise SourceError("mapped data exceeds 16384 canonical UTF-8 bytes")
            # Narrow drift comparison: fields retained by production mapping.
            # Firing endsAt and optional/common envelope fields are not retained.
            retained = dict(retained_data, generatorURL=alert["generatorURL"],
                            event_time=alert["startsAt"] if alert["status"] == "firing" else alert["endsAt"])
            duplicates += remember(identities, (source, identity), CONTRACT.rfc8785.dumps(retained))
        except (SourceError, ValueError) as error:
            errors.append("member " + str(index) + ": " + str(error))
    if errors:
        raise SourceError("; ".join(errors))
    return duplicates


def check_receipt(status, body):
    if type(status) is not int:
        raise SourceError("receipt status must be integer")
    if status not in (200, 202):
        raise SourceError("unsuccessful receipt status " + str(status))
    if not isinstance(body, dict) or type(body.get("seq")) is not int or body["seq"] < 1:
        raise SourceError("successful receipt requires positive original seq")
    if body.get("error") is not None:
        raise SourceError("successful receipt must not contain an error")
    if status == 200 and body.get("duplicate") is not True:
        raise SourceError("200 event receipt requires duplicate true")
    if status == 202 and body.get("duplicate", False) is not False:
        raise SourceError("202 receipt cannot claim duplicate")


def check_response(document, producer, warnings):
    if (not isinstance(document, dict) or set(document) != {"http_status", "body"} or
            type(document["http_status"]) is not int or not isinstance(document["body"], dict)):
        raise SourceError("response capture requires http_status and object body")
    status, body = document["http_status"], document["body"]
    if producer != "alertmanager":
        check_receipt(status, body)
        return
    if status != 200 or not isinstance(body.get("results"), list):
        raise SourceError("adapter response requires outer HTTP200 and results array")
    if len(body["results"]) > 100:
        raise SourceError("adapter results exceed 100 members")
    if not body["results"]:
        warnings.append("empty results cannot establish liveness or any accepted event")
    errors = []
    for index, result in enumerate(body["results"]):
        try:
            if not isinstance(result, dict) or type(result.get("index")) is not int or result["index"] != index:
                raise SourceError("result index must match ordered member position")
            check_receipt(result.get("status"), result)
        except SourceError as error:
            errors.append("member " + str(index) + ": " + str(error))
    if errors:
        raise SourceError("; ".join(errors))


def producer_for(filename):
    stem = filename.removesuffix(".json").removesuffix(".response")
    for name in sorted(NAMES):
        if stem == name or stem.startswith(name + "-"):
            return name
    raise SourceError("unknown capture filename; use a configured producer family")


def check_directory(directory):
    directory = Path(directory)
    missing = [name for name in REQUIRED if not (directory / name).is_file()]
    if missing:
        raise SourceError("missing required capture: " + ", ".join(missing))
    sources = policies(read_capture(directory / "config.json"))
    warnings = ["offline checks do not read credentials or prove live source acceptance",
                "duplicates prove receipt only; genuine new-event cadence requires separate evidence"]
    for name, policy in sorted(sources.items()):
        if "expected_interval" not in policy:
            warnings.append(name + ": expected_interval omitted; silence checks disabled, unseen remains never")
    identities = {}
    duplicates = files = 0
    errors = []
    for path in sorted(directory.glob("*.json")):
        if path.name == "config.json":
            continue
        try:
            producer = producer_for(path.name)
            document = read_capture(path)
            if path.name.endswith(".response.json"):
                check_response(document, producer, warnings)
            elif producer == "alertmanager":
                duplicates += check_alertmanager(document, sources[producer], identities, warnings)
                files += 1
            else:
                duplicates += check_event(document, sources[producer], identities)
                files += 1
        except (SourceError, ValueError) as error:
            errors.append(path.name + ": " + str(error))
    if errors:
        raise SourceError("\n".join(errors))
    return {"files": files, "new_identities": len(identities), "duplicates": duplicates,
            "warnings": sorted(set(warnings))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=DEFAULT_DIRECTORY,
                        help="directory of config and saved JSON captures (default: synthetic examples)")
    args = parser.parse_args()
    try:
        result = check_directory(args.directory)
    except SourceError as error:
        print("FAIL: " + str(error), file=sys.stderr)
        return 1
    print("PASS: " + str(result["files"]) + " payload captures; " + str(result["new_identities"]) +
          " identities; " + str(result["duplicates"]) + " canonical repeats")
    for warning in result["warnings"]:
        print("NOTE: " + warning)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
