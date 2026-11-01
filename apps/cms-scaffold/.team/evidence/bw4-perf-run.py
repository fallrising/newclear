"""Run the unchanged BW1b PostgreSQL performance gate three times and retain compact evidence."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / '.team/evidence'
COMMAND = ['./gradlew', ':services:cms-api:integrationTest', '--tests', '*ListQueryPerformanceTests',
           '--rerun-tasks', '--no-daemon', '--no-parallel', '--console=plain']
rows = []
for number in range(1, 4):
    log = EVIDENCE / f'bw4-perf-{number}.log'
    with log.open('w') as output:
        result = subprocess.run(COMMAND, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
    report = ROOT / 'services/cms-api/build/test-results/integrationTest/TEST-com.fallrising.cms.contract.ListQueryPerformanceTests.xml'
    row = {'run': number, 'exitCode': result.returncode, 'command': COMMAND,
           'logSha256': hashlib.sha256(log.read_bytes()).hexdigest()}
    if report.exists():
        suite = ET.parse(report).getroot()
        row['junit'] = {key: int(suite.get(key, 0)) for key in ['tests', 'failures', 'errors', 'skipped']}
        lines = [line for output in suite.findall('system-out') for line in (output.text or '').splitlines() if 'BW1b perf (' in line]
        row['measurements'] = lines
        if len(lines) == 1:
            found = re.search(r'work list p95 (\d+) ms, public list p95 (\d+) ms, patch p95 (\d+) ms', lines[0])
            if found:
                row['p95Milliseconds'] = dict(zip(['work', 'public', 'patch'], map(int, found.groups())))
    rows.append(row)
    (EVIDENCE / 'bw4-performance.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps(row), flush=True)
    if result.returncode or row.get('junit') != {'tests': 1, 'failures': 0, 'errors': 0, 'skipped': 0} or 'p95Milliseconds' not in row:
        raise SystemExit(f'Performance run {number} did not pass; evidence retained, do not relax thresholds.')
