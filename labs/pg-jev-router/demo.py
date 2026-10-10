import argparse
import json
from fixtures import CASES, oracle
from policy import classify

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synthetic pg-jev routing lab; no model dispatch")
    parser.add_argument("--postgres", action="store_true", help="use real extension in lab container")
    parser.add_argument("--text", help="unknown mock text produces review")
    args = parser.parse_args()
    if args.postgres:
        from pg_adapter import evaluate
    else:
        evaluate = oracle
    rows = [("input", args.text)] if args.text is not None else [(c[0], c[1]) for c in CASES]
    for case_id, text in rows:
        print(json.dumps({"case": case_id, "provider": "deterministic-fixture",
                          "extension": args.postgres, **classify(text, evaluate)}, ensure_ascii=False))
