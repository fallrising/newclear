#!/usr/bin/env python3
"""Read existing synthetic Office runs. Never launch a provider or load credentials."""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys

LAB = Path(__file__).resolve().parents[1]
PROVIDERS = ('opencode', 'grok', 'pi', 'cursor')
RUN_NAME = re.compile(r'(?:local-work|grok-work|pi-work|cursor-work)-[A-Za-z0-9_-]{1,100}\Z')
TOKEN = re.compile(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,127}\Z')
MARKER = re.compile(r'[A-Za-z0-9_-]{1,128}\Z')
SHA256 = re.compile(r'[a-f0-9]{64}\Z')
MAX_RUNS = 1000


class InvalidRun(ValueError):
    pass


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidRun('duplicate_json_key')
        result[key] = value
    return result


def read_json(directory_fd, parts, limit):
    """Use descriptor-relative, no-follow opens for every component, including races."""
    fd = os.dup(directory_fd)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(file_fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise InvalidRun('unsafe_or_oversized_file')
            raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise InvalidRun('oversized_file')
        value = json.loads(raw, object_pairs_hook=reject_duplicates,
                           parse_constant=lambda _: (_ for _ in ()).throw(InvalidRun('nonfinite_json')))
        if not isinstance(value, dict):
            raise InvalidRun('expected_json_object')
        return value, raw
    finally:
        os.close(fd)


def safe_token(value):
    return value if isinstance(value, str) and TOKEN.fullmatch(value) else None


def artifact(run_fd, expected_hash):
    """Only the two fixed synthetic fixture files are eligible for display."""
    try:
        fixture, _ = read_json(run_fd, ('workspace', 'input.json'), 4096)
        result, raw = read_json(run_fd, ('workspace', 'result.json'), 4096)
        marker, values = fixture.get('marker'), fixture.get('values')
        if (set(fixture) != {'marker', 'values'} or not isinstance(marker, str)
                or not MARKER.fullmatch(marker) or not isinstance(values, list)
                or not 1 <= len(values) <= 100
                or any(type(v) is not int or abs(v) > 10**9 for v in values)):
            raise InvalidRun('invalid_fixture')
        if (set(result) != {'marker', 'total'} or result['marker'] != marker
                or type(result['total']) is not int or result['total'] != sum(values)):
            raise InvalidRun('artifact_content_mismatch')
        digest = hashlib.sha256(raw).hexdigest()
        if not isinstance(expected_hash, str) or not SHA256.fullmatch(expected_hash):
            return {'status': 'unverified', 'reason': 'recorded_hash_missing'}
        if digest != expected_hash:
            return {'status': 'unverified', 'reason': 'artifact_hash_mismatch'}
        return {'status': 'verified', 'sha256': digest, 'content': result}
    except FileNotFoundError:
        return {'status': 'unavailable', 'reason': 'artifact_missing'}
    except (OSError, ValueError, UnicodeError, RecursionError):
        return {'status': 'unverified', 'reason': 'artifact_invalid'}


def normalize(run_fd, run_id):
    row = {'id': run_id, 'provider': 'unknown', 'model': None, 'version': None,
           'status': 'invalid', 'artifact': {'status': 'unavailable'}, 'cleanup_verified': False}
    try:
        report, _ = read_json(run_fd, ('result.json',), 2 * 1024 * 1024)
    except FileNotFoundError:
        return dict(row, status='incomplete', reason='report_missing')
    except (OSError, ValueError, UnicodeError, RecursionError):
        return dict(row, reason='report_invalid')
    provider = report.get('provider')
    if report.get('harness') == 'office-opencode' and provider in (None, 'opencode'):
        provider = 'opencode'
    if provider not in PROVIDERS:
        return dict(row, reason='unsupported_provider')
    row['provider'] = provider
    office = report.get('office_result' if provider == 'opencode' else 'office', {})
    if not isinstance(office, dict):
        return dict(row, reason='invalid_native_report')
    row['version'] = safe_token(report.get('version'))
    # Preserve model provenance from the saved native report, never infer it from a CLI default.
    row['model'] = safe_token(office.get('model'))
    requested = safe_token(report.get('model'))
    prefix = {'opencode': 'strata/', 'pi': 'deepseek/'}.get(provider, '')
    model_matches = bool(requested and row['model'] == prefix + requested)
    row['cleanup_verified'] = (report.get('cleanup_errors') == []
                               and office.get('cleanup_completed') is True
                               and (provider not in ('grok', 'cursor')
                                    or report.get('copied_credentials_removed') is True))
    elapsed = report.get('elapsed_s')
    if type(elapsed) in (int, float) and 0 <= elapsed < 10**7 and math.isfinite(elapsed):
        row['elapsed_seconds'] = round(elapsed, 2)
    row['artifact'] = artifact(run_fd, office.get('artifact_sha256'))
    if 'fault_injection' in report:
        fault = report['fault_injection']
        if (provider != 'pi' or not isinstance(fault, dict) or fault.get('source') != 'loopback'
                or type(fault.get('http_status')) is not int or fault.get('http_status') not in (401, 429)):
            return dict(row, status='invalid', reason='invalid_fault_test_metadata')
        row['test_scenario'] = 'injected_http_' + str(fault['http_status'])
        row['failure_check_passed'] = (report.get('failure_check_passed') is True
                                      and report.get('status') == 'failed' and row['cleanup_verified']
                                      and report.get('model_inference_verified') is False
                                      and office.get('native_error_verified') is True
                                      and report.get('client_requests') == 1 and report.get('external_requests') == 0
                                      and report.get('remaining_owned_processes') == 0
                                      and row['artifact']['status'] == 'unavailable')
        return dict(row, status='failed' if report.get('status') == 'failed' else 'unverified',
                    reason='injected_loopback_failure')
    native_fields = {
        'opencode': ('office_native_status_verified', 'file_task_passed', 'model_inference_verified'),
        'pi': ('agent_settled_verified', 'file_task_passed'),
        'cursor': ('native_stop_verified', 'session_hook_verified', 'task_completed', 'file_task_passed'),
        'grok': ('native_stop_verified', 'session_hook_verified', 'task_completed', 'native_model_selection_verified'),
    }
    native_ok = (office.get('provider') == provider and office.get('status') == 'completed'
                 and all(office.get(key) is True for key in native_fields[provider]))
    reported = report.get('status')
    if reported == 'failed':
        row.update(status='failed', reason='runner_reported_failure')
    elif reported == 'cancelled':
        row.update(status='cancelled', reason='runner_reported_user_cancellation')
    elif reported in ('stopped', 'interrupted'):
        row.update(status='stopped', reason='runner_reported_stop')
    elif reported != 'completed':
        row.update(status='incomplete', reason='no_final_report')
    elif report.get('startup_only') is True:
        row.update(status='startup_only', reason='no_task_requested')
    elif (report.get('model_inference_verified') is True and model_matches and native_ok
          and row['cleanup_verified'] and row['artifact']['status'] == 'verified'):
        row['status'] = 'completed'
    else:
        row.update(status='unverified', reason='completion_evidence_incomplete')
    return row


def catalog(roots):
    rows = []
    for number, root in enumerate(roots, 1):
        try:
            root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except OSError:
            raise InvalidRun(f'runs_root_{number}_unavailable') from None
        try:
            names = sorted(name for name in os.listdir(root_fd) if RUN_NAME.fullmatch(name))
            if len(names) + len(rows) > MAX_RUNS:
                raise InvalidRun('too_many_runs')
            for name in reversed(names):
                run_id = f'{number}:{name}'
                try:
                    run_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
                except OSError:
                    rows.append({'id': run_id, 'provider': 'unknown', 'model': None, 'version': None,
                                 'status': 'invalid', 'reason': 'unsafe_run_directory',
                                 'cleanup_verified': False, 'artifact': {'status': 'unavailable'}})
                    continue
                try:
                    rows.append(normalize(run_fd, run_id))
                finally:
                    os.close(run_fd)
        finally:
            os.close(root_fd)
    return {'schema_version': 1, 'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'mode': 'read_only_snapshot', 'providers': list(PROVIDERS), 'runs': rows}


def render_html(data):
    # JSON is data, never HTML; additionally prevent closing the inert script element.
    payload = json.dumps(data, ensure_ascii=True).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    template = (Path(__file__).with_name('office_results.html')).read_text()
    return template.replace('__OFFICE_RESULTS_JSON__', payload)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs-root', action='append', type=Path, help='Explicit runs directory; repeat to combine histories')
    parser.add_argument('--provider', choices=PROVIDERS)
    parser.add_argument('--show', help='Run ID from the list, e.g. 1:grok-work-…')
    parser.add_argument('--html', type=Path, help='Write a NEW private offline HTML snapshot (never overwrite)')
    args = parser.parse_args(argv)
    try:
        data = catalog(args.runs_root or [LAB / 'runs'])
        if args.provider:
            data['runs'] = [r for r in data['runs'] if r['provider'] == args.provider]
        if args.show:
            data['runs'] = [r for r in data['runs'] if r['id'] == args.show]
            if not data['runs']:
                raise InvalidRun('run_not_found')
        if args.html:
            content = render_html(data)
            fd = os.open(args.html, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                stream.write(content)
            print(json.dumps({'status': 'snapshot_written', 'runs': len(data['runs'])}))
        else:
            print(json.dumps(data, indent=2, ensure_ascii=True))
        return 0
    except (OSError, InvalidRun):
        print(json.dumps({'status': 'error', 'reason': 'unavailable_input_or_output',
                          'hint': 'Check runs roots, run ID, file permissions and that HTML output does not exist.'}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
