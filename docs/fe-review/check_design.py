"""Executable AC check for docs/fe-review/SDD.md (fe-review round 1 design deliverables).

Run from the repository root: python3 docs/fe-review/check_design.py [AC-n ...]
Prints one line per AC. Exit 0 only when every selected automated AC passes. Standard library only.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SECTIONS = ("目標", "依據", "不做的事", "修改項目", "啟動方式", "第 3 輪驗收", "開放問題")
# kind "design": every listed component has fe-review/DESIGN.md with all template sections.
AC = {
    "AC-1": (("products/kith",), "design"),
    "AC-2": (("platform/dim-gate",), "design"),
    "AC-3": (("products/hai-taskboard",), "design"),
    "AC-4": (("platform/agent-platform",), "design"),
    "AC-5": (("apps/cms-scaffold",), "design"),
    "AC-6": (("platform/ice-maker",), "design"),
    "AC-7": (("specs/fleet",), "design"),
    "AC-8": (("systems/ojbquay",), "design"),
    "AC-9": (("products/goku",), "design"),
    "AC-10": (("products/phark",), "design"),
    "AC-11": (("apps/flowshot", "apps/loom"), "design"),  # one design, both components
    "AC-12": (("gateways/pokercase",), "design"),
    "AC-13": (("systems/clarkq",), "design"),
    "AC-14": (("platform/fanzloud",), "design"),
}


def check_one(path, kind):
    base = ROOT / path
    design = base / "fe-review/DESIGN.md"
    if not design.is_file():
        return False, f"no {design.relative_to(ROOT)}"
    heads = re.findall(r"^## (.+)$", design.read_text(encoding="utf-8"), re.M)
    missing = [s for s in SECTIONS if not any(h.startswith(s) for h in heads)]
    return (not missing), (f"{design.relative_to(ROOT)} missing {missing}" if missing else str(design.relative_to(ROOT)))


def main(argv):
    failed = 0
    for ac in argv or list(AC):
        paths, kind = AC[ac]
        results = [check_one(p, kind) for p in paths]
        ok = all(r[0] for r in results)
        print(f"{ac}\t{'+'.join(paths)}\t{'PASS' if ok else 'FAIL'}\t{'; '.join(r[1] for r in results)}")
        failed += not ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
