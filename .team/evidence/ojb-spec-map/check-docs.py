from pathlib import Path
import re, subprocess
root = Path.cwd()
paths = [Path(x) for x in subprocess.check_output(["git", "diff", "origin/main", "--name-only"], text=True).splitlines() if x.endswith(".md")]
paths += [Path("systems/ojbquay/docs/specification-map.md"), Path("systems/ojbquay/docs/test-reports/specification-map-20261022.md")]
errors=[]; checked=0
for path in paths:
    if path.as_posix()==".team/PLAN.md": continue
    for link in re.findall(r"\]\(([^)]+)\)", path.read_text()):
        if "://" in link or link.startswith("#"): continue
        target=link.split("#",1)[0]
        if not target: continue
        checked+=1
        if not (path.parent/target).exists(): errors.append(f"{path}: {link}")
text=Path("systems/ojbquay/docs/specification-map.md").read_text()
for number in range(1,12):
    assert f"| AC-{number:02d}：" in text
changed=subprocess.check_output(["git","diff","origin/main","--name-only"],text=True).splitlines()
assert all(x.endswith(".md") or x.startswith(".team/evidence/ojb-spec-map/") for x in changed), changed
assert not errors, "\n".join(errors)
print(f"PASS: {checked} local document links, 11 AC mappings, tracked diff documentation-only")
