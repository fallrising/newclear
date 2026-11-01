#!/usr/bin/env python3
"""Independent pure evidence validator for three actual gateway SIGKILL cases."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
from buffered_cli_check import exact, numeric_equal, validate_summary

CASES = ('buffered_http', 'buffered_claude', 'buffered_cursor')
SOURCES = ('crash_recovery_walkthrough.py', 'crash_recovery_fixture.py',
           'crash_recovery_check.py', 'buffered_cli_check.py', 'offline_fixture.py')
USAGE_SOURCES = {'buffered_http':'openai_chat_v1', 'buffered_claude':'claude_code_stream_event_v1',
                 'buffered_cursor':'cursor_cli_result_v1'}
RAW = ('input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens')
RESET = ('prompt_tokens','completion_tokens','estimated_cost_usd','first_output_ms','total_observed_ms',
         *('reported_'+f for f in RAW))


class InvalidReport(ValueError):
    pass


def require(value, code):
    if not value:raise InvalidReport(code)


def digest(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def loads(raw):
    def pairs(items):
        d={}
        for k,v in items:
            require(k not in d,'duplicate_json_key');d[k]=v
        return d
    def bad(_):raise InvalidReport('nonfinite_json')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=bad)


def normalize(row):
    out=dict(row);raw={f:out.pop('reported_'+f) for f in RAW}
    out['reported_usage']=raw if any(v is not None for v in raw.values()) else None
    return out


def cost_summary(rows):
    known=[r['estimated_cost_usd'] for r in rows if r['estimated_cost_usd'] is not None]
    n=len(rows);k=len(known)
    return {'known_sum':sum(known) if known else None,'known_count':k,'unknown_count':n-k,
            'total_count':n,'coverage':k/n if n else None,
            'status':'no_data' if not n else 'unknown' if not k else 'complete' if k==n else 'partial',
            'basis':'stored_estimate_usd'}


def surfaces(snapshot):
    rows=snapshot['sqlite'];s=snapshot['surfaces'];normal=[normalize(r) for r in rows]
    require(s['scope']=={'selected_ids':[r['id'] for r in rows],'filter':None,
            'events_limit':100,'csv_limit':1000,'day_bucket_limit':30},'surface_scope')
    require(exact(s['events_rows'],list(reversed(normal))),'events_values')
    reader=csv.DictReader(io.StringIO(s['csv_raw']));observed=list(reader)
    require(reader.fieldnames and len(set(reader.fieldnames))==len(reader.fieldnames),'csv_columns')
    require(len(observed)==len(rows),'csv_count')
    for got,want in zip(observed,reversed(rows)):
        require(set(got)==set(want),'csv_fields')
        require(all(got[k]==('' if v is None else str(v)) for k,v in want.items()),'csv_value_missing_zero')
    daily=s['daily_api']
    require(daily['schema_revision']==2,'daily_schema')
    require(daily['scope']=={'day_bucket_limit':30,'selection':'latest_populated_date_prefix_buckets',
                            'denominator':'stored_event_attempt_rows'},'daily_scope')
    require(daily['basis']=={'tokens':'stored_counters_not_subscription_consumption',
            'timing_mean':'known_saved_observations','latency_ms':'mixed_legacy_and_headers_or_cli_ready_compatibility'},'daily_basis')
    validate_summary(daily['measurement_summary'],rows)
    days=sorted({r['ts'][:10] for r in rows},reverse=True)
    require([d['day'] for d in daily['data']]==days,'daily_days')
    for d in daily['data']:
        group=[r for r in rows if r['ts'][:10]==d['day']]
        measurements=validate_summary(d['measurement_summary'],group)
        counts={'requests':len(group),'ok':sum(r['outcome']=='succeeded' for r in group),
                'errors':sum(r['outcome']=='interrupted' for r in group),'incomplete':0,'unknown':0,
                'pending':0,'headers_200':sum(r['status']==200 for r in group)}
        require(all(exact(d[k],v) for k,v in counts.items()),'daily_counts')
        for metric in ('prompt_tokens','completion_tokens'):
            m=measurements[metric];want=m['known_sum'] if m['status']=='complete' else None
            require(exact(d[metric],want),'partial_as_total')
        require(numeric_equal(d['avg_latency_ms'],measurements['latency_ms']['known_mean']),'latency_mean')
        c=cost_summary(group)
        for key,v in c.items():
            require(numeric_equal(d['cost_summary'][key],v) if key in ('coverage','known_sum') else exact(d['cost_summary'][key],v),'cost_coverage')
        require(numeric_equal(d['estimated_cost_usd'],c['known_sum'] if c['status']=='complete' else None),'cost_total')


def process(item):
    require(set(item)=={'pid','birth','state'} and type(item['pid']) is int and item['pid']>1
            and isinstance(item['birth'],str) and item['birth'].isdigit() and item['state']!='Z','owned_identity')
    return item['pid'],item['birth']


def receipt_counts(receipts):
    return {'http_inference':sum(r['kind']=='http_inference' for r in receipts),
            'cli_spawn':sum(r['kind']=='spawn' for r in receipts),
            'cli_input':sum(r['kind']=='input' for r in receipts), 'refresh':0,'discovery':0}


def saved_basis(row, source):
    require(row['usage_source']==source,'usage_source_basis')
    for field in ('headers_ms','cli_ready_ms','first_output_ms','total_observed_ms','latency_ms'):
        value=row[field]
        require(value is None or (type(value) is int and 0<=value<=2**63-1),'saved_clock_type')
    status=row['status']
    require(status is None or (type(status) is int and 100<=status<=599),'saved_status_type')
    if source=='openai_chat_v1':
        require(row['cli_ready_ms'] is None,'http_cli_clock')
        require((status is None)==(row['headers_ms'] is None),'http_headers_pair')
        require(exact(row['latency_ms'],row['headers_ms']),'http_latency_basis')
    else:
        require(status is None and row['headers_ms'] is None,'cli_http_observation')
        require(exact(row['latency_ms'],row['cli_ready_ms']),'cli_latency_basis')


def validate_case(case):
    name=case['name'];require(name in CASES and case['status']=='passed','case_name_status')
    require(case['layer']=='actual_gateway_http_fakecli' and case['client_protocol']=='chat' and case['stream'] is False,'case_layer')
    before=case['before_kill'];killed=case['after_kill'];first,second=case['restarts']
    require(len(before)==len(killed)==2,'row_count')
    h,p=before;kh,kp=killed
    for row in (h,kh):saved_basis(row,'openai_chat_v1')
    for row in (p,kp):
        saved_basis(row,USAGE_SOURCES[name])
        require(row['outcome']=='unknown' and row['usage_status']=='missing','pending_state')
    require(h['public_model']=='history' and p['public_model']==name,'row_models')
    require(h['finalized_at'] is not None and h['outcome']=='succeeded' and h['usage_status']=='complete','history_finalized')
    require(exact(h['prompt_tokens'],5) and exact(h['completion_tokens'],0) and numeric_equal(h['estimated_cost_usd'],1.25),'history_known_values')
    require(exact(h,kh),'history_changed_before_restart')
    for field in ('request_id','attempt_id'):
        require(all(isinstance(r[field],str) and r[field] for r in before) and h[field]!=p[field],'identity_missing_duplicate')
    require(len({r['id'] for r in before})==2,'duplicate_id')
    require(p['finalized_at'] is None and kp['finalized_at'] is None,'not_pending_at_kill')
    mutable={'status','headers_ms','cli_ready_ms','latency_ms'}
    require(exact({k:v for k,v in p.items() if k not in mutable},{k:v for k,v in kp.items() if k not in mutable}),'kill_changed_identity_or_usage')
    for k in mutable:
        require(p[k] is None or exact(p[k],kp[k]),'saved_observation_changed')
    require(all(kp[k] is None for k in RESET),'pending_invented_usage')
    kill=case['kill'];identity=process(kill['identity'])
    require(kill['signal']==9 and type(kill['signal']) is int and kill['target']=='owned_gateway_pid'
            and kill['target_pid']==identity[0] and kill['returncode']==-9 and kill['identity_checked'] is True,'sigkill_not_observed')
    receipts=case['receipts_before_kill']
    require([r['sequence'] for r in receipts]==list(range(1,len(receipts)+1)),'receipt_sequence')
    kinds=['http_inference','http_inference'] if name=='buffered_http' else ['http_inference','spawn','input']
    require([r['kind'] for r in receipts]==kinds,'receipt_inventory')
    for r in receipts:
        row=h if r['model']=='history' else p
        require(r['model'] in ('history',name) and exact(r['pending'],{k:row[k] for k in ('id','request_id','attempt_id','public_model','usage_source')}),'dispatch_identity')
        process(r['process'])
        if r['kind']=='http_inference':
            u=urlsplit(r['destination']);require(u.scheme=='http' and u.hostname=='127.0.0.1' and u.port in case['isolation']['fixture_ports'] and u.path=='/v1/chat/completions' and not u.query and not u.fragment and not u.username,'unsafe_upstream')
            require(r['method']=='POST' and r['auth_valid'] is True,'upstream_auth')
        else:require(r['provider']==name.removeprefix('buffered_'),'cli_provider')
    if name!='buffered_http':
        require(process(receipts[-1]['process'])==process(receipts[-2]['process']),'cli_exec_identity')
        require(receipts[-1]['input_basis']==('stdin_json_user' if name=='buffered_claude' else 'validated_prompt_argv'),'cli_input_basis')
    require(exact(case['receipts_final'],receipts),'late_restart_replay')
    require(exact(case['counts'],receipt_counts(receipts)),'dispatch_counts')
    identities={identity}
    for index,snapshot in enumerate((first,second),1):
        require(snapshot['restart']==index,'restart_order');ip=process(snapshot['gateway']);require(ip not in identities,'restart_identity_reused');identities.add(ip)
        require(exact(snapshot['receipts'],receipts),'restart_replay')
        rr=snapshot['sqlite'];require(len(rr)==2 and exact(rr[0],h),'history_mutated')
        expected=dict(kp);expected.update(finalized_at=rr[1]['finalized_at'],outcome='interrupted',usage_status='missing',error='stream_interrupted')
        expected.update(dict.fromkeys(RESET))
        require(isinstance(expected['finalized_at'],str) and expected['finalized_at'],'recovery_finalization_missing')
        require(exact(rr[1],expected),'recovery_value_or_identity')
        surfaces(snapshot)
    require(exact(first['sqlite'],second['sqlite']),'second_recovery_changed')
    expected_children={process(r['process']) for r in receipts if r['kind'] in ('spawn','input')}
    for field in ('harness_fake_cleanup','final_fake_cleanup'):
        observed=case[field]
        require(isinstance(observed,list) and len(observed)==len(expected_children),'fake_cleanup_inventory')
        require({(r['pid'],r['birth']) for r in observed}==expected_children and all(r['stopped'] is True for r in observed),'fake_cleanup_identity')
    iso=case['isolation']
    home=Path(iso['owned_home']);require(home.is_absolute(),'owned_home_path')
    require(iso['fake_executables']==[str(home/'fake'/n) for n in ('claude','cursor-agent','runtime')],'owned_fake_paths')
    require(Path(iso['python']).is_absolute() and all(re.fullmatch('[0-9a-f]{64}',iso[k]) for k in ('fake_sha256','python_sha256')),'fake_python_pins')
    require(iso['proved_before_dispatch'] is True and iso['synthetic_home_db'] is True and iso['environment_cleared'] is True
            and iso['no_provider_configuration_before_launch'] is True and iso['absolute_owned_fake_executables'] is True,'isolation_missing')
    require(iso['probes']==[{'method':'GET','target':'unknown','status':403},{'method':'CONNECT','target':'connect','status':403},{'method':'GET','target':'redirect','status':403}]
            and iso['proof_denied_requests']==3 and iso['denied_requests_final']==3,'isolation_probes')
    trace=case['request_trace'];require([r['sequence'] for r in trace]==list(range(1,len(trace)+1)),'request_sequence')
    for req in trace:
        u=urlsplit(req['destination']);require(u.scheme=='http' and u.hostname=='127.0.0.1' and u.port in case['gateway_ports'] and u.path=='' and not u.query and not u.fragment and not u.username,'unsafe_gateway_destination')
        require(req['path'].startswith('/admin/api/') if req['kind']=='admin' else req['path']=='/v1/chat/completions','request_path')
    require(sum(r['kind']=='client' for r in trace)==2 and case['client_requests']==2,'client_count')
    require(case['admin_requests']==sum(r['kind']=='admin' for r in trace),'admin_count')
    cleanup=case['cleanup'];require(cleanup=={'gateway_stopped':True,'fake_children_stopped':True,'fixture_closed':True,
        'temporary_data_removed':True,'listeners_released':True,'fake_child_cleanup_basis':'harness_pid_birth_checked_not_product_guarantee'},'cleanup_missing')


def validate_report(report, expected_binary_sha256=None, expected_sources=None):
    require(report['schema_version']==1 and report['status']=='passed' and report['synthetic'] is True,'report_status')
    require(report['case_inventory']==list(CASES) and [c['name'] for c in report['cases']]==list(CASES),'case_inventory')
    require(report['owner_personal_run_claimed'] is False and report['live_client_version_provider_verified'] is False
            and report['whole_round_metrics'] is None and report['actual_cost_usd'] is None,'overclaimed')
    require(report['stream_coverage']=='existing_native_regression_separate_not_these_cases','stream_claim')
    require(re.fullmatch('[0-9a-f]{64}',report['binary_sha256']) is not None,'binary_digest')
    if expected_binary_sha256 is not None:require(report['binary_sha256']==expected_binary_sha256,'binary_pin')
    require(set(report['source_sha256'])==set(SOURCES) and all(re.fullmatch('[0-9a-f]{64}',v) for v in report['source_sha256'].values()),'source_inventory')
    if expected_sources is not None:require(exact(report['source_sha256'],expected_sources),'source_pin')
    for case in report['cases']:validate_case(case)
    return {'status':'passed','cases':3,'layer':'actual_gateway_http_fakecli','live_verified':False}


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify-report',required=True,type=Path)
    p.add_argument('--expected-binary-sha256',required=True);args=p.parse_args(argv)
    require(args.verify_report.stat().st_size<=4*1024*1024,'report_size')
    validate_report(loads(args.verify_report.read_bytes()),args.expected_binary_sha256)
    print('Crash recovery report: passed (pure verification)')


if __name__=='__main__':main()
