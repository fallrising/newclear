"""Synthetic fixtures, real upstream execution. No agent CLI or model is called."""
from __future__ import annotations
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import sys

# -I intentionally omits script directories; add only this verified lab and pinned package.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from isolation import install


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


def fixture_repo(root):
    """Minimal synthetic Git metadata consumed by upstream's no-subprocess identity reader."""
    (root / '.git/info').mkdir(parents=True)
    (root / '.git/HEAD').write_text('ref: refs/heads/main\n')
    (root / '.git/config').write_text('[remote "origin"]\nurl = https://example.invalid/lab/demo.git\n')
    return root


def session(path, prompts):
    rows = []
    n = 0
    for prompt, calls in prompts:
        rows.append({'type': 'user', 'message': {'role': 'user', 'content': prompt}})
        for name, args, output, error in calls:
            n += 1
            rows.append({'type': 'assistant', 'message': {
                'id': f'{path.stem}-{n}', 'role': 'assistant', 'model': 'claude-sonnet-4-5',
                'usage': {'input_tokens': 10, 'cache_read_input_tokens': 1000,
                          'cache_creation_input_tokens': 100, 'output_tokens': 50},
                'content': [{'type': 'tool_use', 'id': f't{n}', 'name': name, 'input': args}]}})
            rows.append({'type': 'user', 'message': {'role': 'user', 'content': [
                {'type': 'tool_result', 'tool_use_id': f't{n}', 'content': output, 'is_error': error}]}})
    path.write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
    return path


def execute(source, sandbox):
    sys.path.insert(0, str(source))
    blocked = install(sandbox, source)
    from tokeneconomizer import trace, pricing
    from tokeneconomizer.plugin import hook, cli, denylist
    from tokeneconomizer.plugin.context import LiveContext
    from tokeneconomizer.plugin import hosts

    results = []
    checks = 0

    def expect(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            raise AssertionError(message)

    def setup(name, **overrides):
        work = sandbox / name
        repo = fixture_repo(work / 'repo')
        env = dict(os.environ, TOKENECONOMIZER_HOME=str(work / 'home'),
                   TE_FOLD_SYNC='1', TE_MICROSKILLS='off', TE_TOOLPRUNE='off',
                   TE_LOOPGUARD='off', TE_MODE='interactive',
                   GIT_CEILING_DIRECTORIES=str(sandbox))
        env.update(overrides)
        return work, repo, env

    def call(env, payload):
        out = io.StringIO()
        hook.main(['--host', 'claude'], io.StringIO(json.dumps(payload)), out, env)
        return json.loads(out.getvalue().splitlines()[-1])

    def run_session(env, repo, sid, path):
        base = {'session_id': sid, 'cwd': str(repo), 'transcript_path': str(path)}
        start = call(env, dict(base, hook_event_name='SessionStart', source='startup'))
        call(env, dict(base, hook_event_name='SessionEnd', reason='other'))
        return start

    def context(env, repo):
        return LiveContext.build(hosts.detect({}, hint='claude'), str(repo), env)

    def command(env, repo, *args):
        previous = dict(os.environ)
        os.environ.clear()
        os.environ.update(env)
        try:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = cli.main(['--host', 'claude', '--cwd', str(repo), *args])
            expect(code == 0, f'CLI failed: {args}')
            return out.getvalue()
        finally:
            os.environ.clear()
            os.environ.update(previous)

    # AC-02: real hook -> fold -> distiller -> persisted facts -> next-session injection.
    work, repo, env = setup('microskills', TE_MICROSKILLS='envfacts')
    renders = []
    for i in range(4):
        path = session(work / f'trap-{i}.jsonl', [(f'fix synthetic bug {i}', [
            ('Edit', {'file_path': 'pkg/module.py', 'old_string': 'a', 'new_string': 'b'}, 'ok', False),
            ('Bash', {'command': 'pytest -q'}, 'bash: pytest: command not found', True),
            ('Bash', {'command': 'python -m pytest -q'}, '1 passed in 0.1s', False),
        ])])
        run_session(env, repo, f'trap-{i}', path)
        renders.append(context(env, repo).store.read('injection.json')['rendered'])
    expect(not any(renders[:3]), 'fact injected before evidence/firing threshold')
    expect('python -m pytest' in renders[3], 'four sessions did not form fact')
    store = context(env, repo).store
    before = store.read('injection.json')['sessions']
    run_session(env, repo, 'trap-3', path)
    expect(store.read('injection.json')['sessions'] == before, 'duplicate session counted twice')
    empty = work / 'next.jsonl'
    empty.write_text('')
    injected = call(env, {'hook_event_name': 'SessionStart', 'session_id': 'next',
                         'source': 'startup', 'cwd': str(repo), 'transcript_path': str(empty)})
    expect('python -m pytest' in json.dumps(injected), 'fact not delivered by real hook')
    for i in range(2):
        path = session(work / f'fixed-{i}.jsonl', [('environment fixed', [
            ('Bash', {'command': 'pytest -q'}, '1 passed in 0.1s', False)])])
        run_session(env, repo, f'fixed-{i}', path)
    expect(not store.read('injection.json')['rendered'], 'two contradictory sessions did not retire fact')
    results.append({'id': 'micro-skills', 'status': 'passed', 'mode': 'envfacts; no proposer',
                    'rendered_after_sessions': [bool(x) for x in renders],
                    'injected_fact': renders[3], 'retired_after_contradictions': 2,
                    'duplicate_session_ignored': True,
                    'cli': command(env, repo, 'microskills')})

    # AC-03: live prompt/session rule, not the different experiment-only session threshold.
    work, repo, env = setup('toolprune', TE_TOOLPRUNE='propose')
    write_json(work / 'home/hosts/claude/catalog.json', {'tools': [
        'Bash', 'Read', 'Edit', 'Write', 'WebFetch', 'AskUserQuestion',
        'Workflow', 'CronCreate', 'NotebookEdit']})
    proposals = []
    for i in range(2):
        calls = [('Bash', {'command': 'ls'}, 'demo.py', False)]
        if i == 0:
            calls.append(('Workflow', {'name': 'synthetic'}, 'done', False))
        path = session(work / f'prune-{i}.jsonl', [
            (f'prompt {n}', calls if n == 0 else []) for n in range(5)])
        run_session(env, repo, f'prune-{i}', path)
        proposals.append(context(env, repo).store.read('untool.json')['proposal'])
    expect(proposals[0] == [], 'one session incorrectly sufficient')
    expect(proposals[1] == ['CronCreate'], 'proposal did not preserve used/protected/high-risk tools')
    store = context(env, repo).store
    expect(not Path(denylist.settings_path(str(repo))).exists(), 'propose modified settings')
    cfg = Path(denylist.settings_path(str(repo)))
    original = {'permissions': {'deny': ['Bash(rm -rf:*)'], 'allow': ['Read']}, 'model': 'user-choice'}
    write_json(cfg, original)
    apply_text = command(env, repo, 'toolprune', 'apply')
    applied = json.loads(cfg.read_text())
    expect(applied['permissions']['deny'] == ['Bash(rm -rf:*)', 'CronCreate'], 'apply damaged user deny rule')
    expect(applied['model'] == original['model'], 'apply damaged other settings')
    restore_text = command(env, repo, 'toolprune', 'restore')
    expect(json.loads(cfg.read_text()) == original, 'restore did not preserve exact user settings')
    expect(denylist.kept_for(store, str(repo)) == ['CronCreate'], 'restore did not persist keep')
    path = session(work / 'after-restore.jsonl', [('again', [('Bash', {'command': 'ls'}, 'a.py', False)])])
    run_session(env, repo, 'after-restore', path)
    expect('CronCreate' not in store.read('untool.json')['proposal'], 'restored tool re-proposed')
    results.append({'id': 'tool-pruning', 'status': 'passed', 'host': 'claude schema (synthetic)',
                    'prompts_per_session': 5, 'proposal_by_session': proposals,
                    'protected_and_ever_used_preserved': True, 'high_risk_deferred': True,
                    'apply': apply_text, 'restore': restore_text, 'original_rules_preserved': True,
                    'settings_after_restore': original})

    # Boundary cases: prove both branches of the live evidence rule, including its floor.
    boundaries = {}
    for label, prompt_counts, catalog, expected in [
        ('single-long', [10, 1], ['Bash', 'CronCreate'], [[], ['CronCreate']]),
        ('five-short', [1, 1, 1, 1, 1], ['Bash', 'CronCreate'], [[], [], [], [], ['CronCreate']]),
        ('high-risk', [15, 15], ['Bash', 'NotebookEdit'], [[], ['NotebookEdit']]),
    ]:
        bwork, brepo, benv = setup(label, TE_TOOLPRUNE='propose')
        write_json(bwork / 'home/hosts/claude/catalog.json', {'tools': catalog})
        actual = []
        for i, count in enumerate(prompt_counts):
            path = session(bwork / f'session-{i}.jsonl', [
                (f'prompt {n}', [('Bash', {'command': 'ls'}, 'a.py', False)] if n == 0 else [])
                for n in range(count)])
            run_session(benv, brepo, f'session-{i}', path)
            actual.append(context(benv, brepo).store.read('untool.json')['proposal'])
        expect(actual == expected, 'evidence boundary failed: ' + label)
        boundaries[label] = {'prompts_per_session': prompt_counts, 'proposals': actual}
    # Invalid settings and an escaping settings-directory symlink are refused by upstream.
    invalid = repo / '.claude/settings.local.json'
    invalid.write_text('{not-json')
    try:
        denylist.apply(str(repo), ['CronCreate'], store)
    except RuntimeError:
        pass
    else:
        raise AssertionError('upstream accepted invalid user settings')
    expect(invalid.read_text() == '{not-json', 'invalid settings overwritten')
    invalid.unlink()
    invalid.parent.rmdir()
    outside_repo = work / 'other-project'
    outside_repo.mkdir()
    (repo / '.claude').symlink_to(outside_repo, target_is_directory=True)
    try:
        denylist.apply(str(repo), ['CronCreate'], store)
    except RuntimeError:
        pass
    else:
        raise AssertionError('upstream followed escaping settings symlink')
    expect(list(outside_repo.iterdir()) == [], 'upstream changed other project')
    results[1]['evidence_boundaries'] = boundaries
    results[1]['invalid_json_and_symlink_refused'] = True

    # Explicitly seed a PAUSED model-call state: real guard runs its hard-backstop path.
    # This is not a real login failure and is not a fake successful judge verdict.
    work, repo, env = setup('loopguard', TE_LOOPGUARD='on')
    write_json(work / 'home/hosts/claude/sidecall.json',
               {'at': 1, 'reason': 'synthetic lab fixture: model calls intentionally paused'})

    def turn(key, calls):
        base = {'session_id': 'guard-session', 'prompt_id': key, 'cwd': str(repo), 'transcript_path': ''}
        call(env, dict(base, hook_event_name='UserPromptSubmit', prompt='synthetic task'))
        outputs = [call(env, dict(base, hook_event_name='PostToolUse', tool_name=name,
                                  tool_input=args, tool_response=result))
                   for name, args, result in calls]
        call(env, dict(base, hook_event_name='Stop', stop_hook_active=False))
        return outputs

    stuck = [('Edit', {'file_path': 'pkg/a.py', 'old_string': 'x', 'new_string': 'y'}, 'ok')
             if n % 2 == 0 else ('Bash', {'command': 'pytest -q'},
                 {'stdout': 'FAILED tests/test_a.py::test_x - AssertionError: assert 1 == 2', 'stderr': ''})
             for n in range(80)]
    cold = turn('cold', stuck)
    expect(all(not o for o in cold), 'cold start intervened')
    expect(not context(env, repo).store.read('envelope.json')['resolved_turns'], 'failed turn trained envelope')
    green = [('Read', {'file_path': 'pkg/a.py'}, 'read synthetic source')] * 7 + [
        ('Bash', {'command': 'python -m pytest -q'}, {'stdout': '1 passed in 0.1s', 'stderr': ''})]
    for n in range(5):
        turn(f'green-{n}', green)
    envelope = context(env, repo).store.read('envelope.json')
    expect(envelope['resolved_turns'] == [8] * 5, 'green envelope incorrect')
    warm = turn('warm', stuck)
    nudges = [(i + 1, o) for i, o in enumerate(warm) if 'nudged' in o.get('systemMessage', '')]
    notices = [(i + 1, o) for i, o in enumerate(warm) if 'still looks stuck' in o.get('systemMessage', '')]
    expect(len(nudges) == len(notices) == 1, 'expected one redirect and one notice')
    expect(nudges[0][0] < notices[0][0], 'notice preceded redirect')
    expect('cum-backstop' in nudges[0][1]['systemMessage'], 'not exercising actual paused backstop')
    expect(all('continue' not in o and o.get('decision') != 'block' for o in warm), 'hook stopped turn')
    productive = turn('productive-long', [('Read', {'file_path': f'pkg/m{n}.py'}, 'ok') for n in range(80)])
    expect(all(not o for o in productive), 'productive long turn interrupted')
    results.append({'id': 'loop-guard', 'status': 'passed',
                    'mode': 'real hooks, synthetic paused judge state; hard backstop only',
                    'cold_events': 0, 'green_training_turns': 5,
                    'training_calls_per_turn': 8, 'nudge_at_call': nudges[0][0],
                    'notice_at_call': notices[0][0], 'automatic_stop': False,
                    'productive_80_call_events': 0, 'nudge': nudges[0][1], 'notice': notices[0][1]})

    # AC-05: usage reader deduplicates repeated content blocks; pricing uses explicit toy weights.
    work, repo, env = setup('accounting')
    path = work / 'usage.jsonl'
    usage = {'input_tokens': 1000, 'cache_read_input_tokens': 10000,
             'cache_creation_input_tokens': 500, 'output_tokens': 200}
    rows = [{'type': 'assistant', 'message': {'id': 'same-message', 'role': 'assistant',
             'model': 'claude-sonnet-4-5', 'usage': usage,
             'content': [{'type': 'text', 'text': f'block {n}'}]}} for n in range(3)]
    path.write_text(''.join(json.dumps(x) + '\n' for x in rows))
    parsed = trace.claude_session_usage(str(path), include_subagents=False)
    expect(parsed['requests'] == 1, 'usage counted repeated message blocks')
    expect(all(parsed[k] == v for k, v in usage.items()), 'usage fields changed')
    weights = {'input': 1, 'cache_read': 0.1, 'cache_write': 1.25, 'output': 5}
    effective = pricing.effective_tokens(parsed, weights=weights)
    expect(effective == 3625, 'cache-aware weighted arithmetic wrong')
    sidecall_usage = {'input_tokens': 100, 'cache_read_input_tokens': 0,
                      'cache_creation_input_tokens': 0, 'output_tokens': 50}
    overhead = pricing.effective_tokens(sidecall_usage, weights=weights)
    expect(overhead == 350, 'side-call cost arithmetic wrong')
    results.append({'id': 'accounting-and-cli', 'status': 'passed', 'input': 'synthetic usage',
                    'raw_tokens': sum(usage.values()), 'explicit_illustrative_weights': weights,
                    'weighted_input_equivalents': effective, 'illustrative_sidecall_equivalents': overhead,
                    'total_including_illustrative_sidecall': effective + overhead,
                    'not_current_prices_or_measured_savings': True,
                    'config': command(env, repo, 'config'), 'cli_status': command(env, repo, 'status')})
    expect(not blocked, 'scenario attempted forbidden access: ' + str(blocked))
    return {'schema': 1, 'result': 'passed', 'scenarios': results, 'assertions': checks,
            'execution': 'real pinned TokenEconomizer package/hooks/CLI; synthetic inputs',
            'provider_calls': 0, 'real_savings_measured': False,
            'runtime_guard': {'blocked_attempts': blocked, 'network': 'denied', 'subprocess': 'denied',
                              'environment': 'credential-free allowlist', 'writes': 'fresh sandbox only'},
            'not_exercised': ['live host installation and tool-schema removal', 'model-backed proposer',
                              'model judge quality', 'provider billing or task-quality A/B',
                              'Codex/Copilot/Pi/opencode live integrations']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--sandbox', type=Path, required=True)
    args = parser.parse_args()
    report = execute(args.source, args.sandbox)
    # Stable public evidence: replace sandbox-only absolute fixture paths, not user data.
    print(json.dumps(report, ensure_ascii=False).replace(str(args.sandbox), '<sandbox>'))
