#!/usr/bin/env python3
"""Offline source/publication checks, without starting models or importing fixtures."""
import ast
import json
from pathlib import Path
import re
import subprocess
import tomllib
from urllib.parse import unquote

LAB = Path(__file__).resolve().parents[1]
REPO = LAB.parents[1]
PREFIX = LAB.relative_to(REPO).as_posix()
names = subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', PREFIX],
    cwd=REPO).decode().split('\0')
files = sorted({REPO / name for name in names if name})
errors = []
for path in files:
    rel = path.relative_to(LAB)
    if path.is_symlink():
        errors.append(f'{rel}: symlinks must not be published')
        continue
    forbidden = {'runs', 'state', 'projects', 'vendor', 'node_modules', '.npm-cache', '__pycache__', '.venv'}
    if forbidden.intersection(rel.parts) or path.suffix in {'.gguf', '.safetensors', '.db', '.sqlite', '.pyc'} or path.name.startswith('.env'):
        errors.append(f'{rel}: runtime/private artifact included')
        continue
    if path.stat().st_size > 1_000_000:
        errors.append(f'{rel}: oversized source artifact')
        continue
    try:
        content = path.read_text()
        if re.search('/' + r'(?:Users|home)/[^\s/]+/', content):
            errors.append(f'{rel}: personal absolute path')
        if re.search(r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----', content):
            errors.append(f'{rel}: possible credential; inspect locally')
        if path.suffix == '.py' or rel.as_posix() in {'scripts/bin/opencode', 'scripts/bin/pi', 'scripts/bin/grok', 'scripts/bin/cursor-agent'}:
            ast.parse(content, filename=str(rel))
        elif path.suffix == '.json':
            json.loads(content)
        elif path.suffix == '.toml':
            tomllib.loads(content)
        elif path.suffix == '.mjs':
            subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
        if path.suffix == '.md':
            for target in re.findall(r'\[[^\]]*\]\(([^\s)]+)\)', content):
                if re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                    continue
                dest = (path.parent / unquote(target.split('#')[0])).resolve()
                if not dest.is_relative_to(REPO) or not dest.exists():
                    errors.append(f'{rel}: broken/outside link {target}')
    except (ValueError, SyntaxError, UnicodeError, subprocess.CalledProcessError) as error:
        errors.append(f'{rel}: {type(error).__name__}')
print('\n'.join(errors) if errors else f'PASS: {len(files)} public source files, syntax and local links')
raise SystemExit(bool(errors))
