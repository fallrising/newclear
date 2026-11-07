"""Pure evidence checks; never start a gateway, CLI, subprocess or socket."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import buffered_cli_check as check


def row(source="claude_code_stream_event_v1"):
    return {"id": 1, "ts": "2026-10-30T04:00:00Z", "attempt_id": "attempt-a",
            "request_id": "request-a", "finalized_at": "2026-10-30T04:00:01Z",
            "usage_source": source, "outcome": "succeeded", "usage_status": "partial",
            "status": None, "headers_ms": None, "estimated_cost_usd": None,
            "cli_ready_ms": 0, "first_output_ms": 2, "total_observed_ms": 3,
            "latency_ms": 0, "prompt_tokens": None, "completion_tokens": 5,
            "reported_usage": {"input_tokens": 12, "output_tokens": 5,
                               "cache_read_input_tokens": None,
                               "cache_creation_input_tokens": None}}


def artifact_fixture(root):
    items=[]
    for name in ('thinrouter','python-runtime',*check.SOURCE_FILES):
        path=root/name;path.write_text('#!/usr/bin/env python3\n# synthetic source\n')
        role=('binary' if name=='thinrouter' else 'runtime' if name=='python-runtime' else
              'fixture' if name=='buffered_cli_fixture.py' else 'checker' if name=='buffered_cli_check.py' else
              'walkthrough' if name=='buffered_cli_walkthrough.py' else 'helper')
        items.append({'role':role,'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    invocation=str(root/'python-runtime')
    generated='#!'+invocation+'\n# synthetic source\n'
    return {'schema_version':1,'artifacts':items,'python_invocation':invocation,
            'generated_fixture_sha256':hashlib.sha256(generated.encode()).hexdigest()}


class PureChecks(unittest.TestCase):
    def setUp(self):
        self.process = patch("subprocess.Popen", side_effect=AssertionError("no process"))
        self.socket = patch("socket.socket", side_effect=AssertionError("no socket"))
        self.process.start()
        self.socket.start()
        self.addCleanup(self.process.stop)
        self.addCleanup(self.socket.stop)

    def test_empty_unknown_partial_zero_and_complete_are_distinct(self):
        self.assertEqual(check.expected_measurements([])["prompt_tokens"], {
            "known_sum": None, "known_mean": None, "known_count": 0,
            "unknown_count": 0, "total_count": 0, "coverage": None,
            "status": "no_data", "basis": "stored_prompt_tokens"})
        a, b = row(), row()
        b["prompt_tokens"] = 0
        unknown = check.expected_measurements([a])["prompt_tokens"]
        partial = check.expected_measurements([a, b])["prompt_tokens"]
        zero = check.expected_measurements([b])["prompt_tokens"]
        self.assertEqual((unknown["known_sum"], unknown["status"]), (None, "unknown"))
        self.assertEqual((partial["known_sum"], partial["coverage"], partial["status"]), (0, .5, "partial"))
        self.assertEqual((zero["known_sum"], zero["status"]), (0, "complete"))
        b["first_output_ms"] = None
        self.assertEqual(check.expected_measurements([a, b])["first_output_ms"]["known_mean"], 2)

    def test_metric_negative_values_booleans_and_missing_fields_are_rejected(self):
        for bad in (-1, True, 1.5, 2**63):
            with self.subTest(value=bad), self.assertRaises(check.CheckFailure):
                check.expected_measurements([dict(row(), completion_tokens=bad)])
        a = row(); del a["headers_ms"]
        with self.assertRaises(check.CheckFailure):
            check.expected_measurements([a])

    def test_summary_keeps_integer_null_basis_and_status_exact(self):
        a = row()
        good = check.expected_measurements([a])
        check.validate_summary(good, [a])
        for metric, field, bad in (("headers_ms", "known_sum", 0),
                ("prompt_tokens", "status", "complete"),
                ("completion_tokens", "known_count", True),
                ("cli_ready_ms", "basis", "stored_headers_ms"),
                ("first_output_ms", "known_mean", 1),
                ("completion_tokens", "total_count", 2)):
            with self.subTest(field=field), self.assertRaises(check.CheckFailure):
                changed = copy.deepcopy(good); changed[metric][field] = bad
                check.validate_summary(changed, [a])

    def test_codec_rounding_has_only_the_declared_narrow_bound(self):
        rows = [row() for _ in range(54)]
        rows[0]["first_output_ms"] = None
        rows[1]["first_output_ms"] = None
        summary = check.expected_measurements(rows)
        summary["first_output_ms"]["coverage"] = .9629629629629628
        check.validate_summary(summary, rows)
        for bad in (float("nan"), float("inf"), -1, 1.1, .9629629629629):
            with self.subTest(value=bad), self.assertRaises(check.CheckFailure):
                summary["first_output_ms"]["coverage"] = bad
                check.validate_summary(summary, rows)

    def test_claude_complete_requires_three_explicit_input_buckets(self):
        a = row(); check.validate_cli_row(a)
        a.update(prompt_tokens=12, usage_status="complete")
        with self.assertRaises(check.CheckFailure): check.validate_cli_row(a)
        a["reported_usage"].update(cache_read_input_tokens=0, cache_creation_input_tokens=0)
        check.validate_cli_row(a)
        a["prompt_tokens"] = 11
        with self.assertRaises(check.CheckFailure): check.validate_cli_row(a)

    def test_cursor_input_never_becomes_normalized_subscription_prompt(self):
        a = row("cursor_cli_result_v1")
        a["reported_usage"].update(cache_read_input_tokens=0, cache_creation_input_tokens=0)
        check.validate_cli_row(a)
        for change in ({"prompt_tokens":12}, {"usage_status":"complete"},
                       {"completion_tokens":0}, {"estimated_cost_usd":0},
                       {"status":200}, {"headers_ms":0}, {"usage_source":"openai_chat_v1"}):
            with self.subTest(change=change), self.assertRaises(check.CheckFailure):
                check.validate_cli_row(dict(a, **change))

    def test_source_time_null_and_legacy_ready_do_not_alias_headers_or_total(self):
        a = row()
        for change in ({"latency_ms":3}, {"first_output_ms":4},
                       {"cli_ready_ms":None}, {"total_observed_ms":None},
                       {"first_output_ms":True}, {"finalized_at":None}):
            with self.subTest(change=change), self.assertRaises(check.CheckFailure):
                check.validate_cli_row(dict(a, **change))
        a.update(cli_ready_ms=None, latency_ms=None, first_output_ms=None,
                 total_observed_ms=None, outcome="interrupted", usage_status="missing",
                 completion_tokens=None, reported_usage=None)
        check.validate_cli_row(a)

    def test_invalid_usage_keeps_valid_siblings_without_fabricated_zero(self):
        a = row("cursor_cli_result_v1"); a["usage_status"] = "invalid"
        a["reported_usage"]["input_tokens"] = None
        check.validate_cli_row(a)
        a["reported_usage"]["input_tokens"] = -1
        with self.assertRaises(check.CheckFailure): check.validate_cli_row(a)

    def test_artifact_guard_hashes_files_before_any_possible_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = artifact_fixture(root)
            check.verify_artifacts(manifest)
            for mutate in (lambda v:v["artifacts"].pop(),
                           lambda v:v["artifacts"][0].update(sha256="0"*64),
                           lambda v:v["artifacts"][0].update(path="relative"),
                           lambda v:v["artifacts"].append(v["artifacts"][0])):
                with self.subTest(mutate=mutate), self.assertRaises(check.CheckFailure):
                    bad=copy.deepcopy(manifest); mutate(bad);check.verify_artifacts(bad)


def surfaces_fixture(rows):
    """Render synthetic API/CSV/template transport; never query product code."""
    import csv
    import html
    import io
    def summary(group):
        result = {}
        for metric in check.METRICS:
            values = [r[metric] for r in group if r[metric] is not None]
            result[metric] = {"known_sum":sum(values) if values else None,
                "known_mean":sum(values)/len(values) if values and metric.endswith("_ms") else None,
                "known_count":len(values), "unknown_count":len(group)-len(values),
                "total_count":len(group), "coverage":len(values)/len(group) if group else None,
                "status":"no_data" if not group else "unknown" if not values else
                         "complete" if len(values)==len(group) else "partial",
                "basis":"stored_legacy_latency_ms" if metric=="latency_ms" else "stored_"+metric}
        return result
    days=sorted({r['ts'][:10] for r in rows},reverse=True)
    selected=[r for r in rows if r['ts'][:10] in days[:30]]
    daily={"schema_revision":2,"scope":{"day_bucket_limit":30,
        "selection":"latest_populated_date_prefix_buckets","denominator":"stored_event_attempt_rows"},
        "basis":{"tokens":"stored_counters_not_subscription_consumption",
          "timing_mean":"known_saved_observations",
          "latency_ms":"mixed_legacy_and_headers_or_cli_ready_compatibility"},
        "measurement_summary":summary(selected),"data":[]}
    for day in days[:30]:
        group=[r for r in rows if r['ts'][:10]==day]; metrics=summary(group)
        daily['data'].append({'day':day,'measurement_summary':metrics,
            'requests':len(group),'ok':sum(r['outcome']=='succeeded' for r in group),
            'errors':sum(r['outcome'] in ['failed','cancelled','timeout','interrupted'] for r in group),
            'incomplete':sum(r['outcome']=='incomplete' for r in group),
            'unknown':sum(r['outcome']=='unknown' for r in group),'pending':0,'headers_200':0,
            'prompt_tokens':metrics['prompt_tokens']['known_sum'] if metrics['prompt_tokens']['status']=='complete' else None,
            'completion_tokens':metrics['completion_tokens']['known_sum'] if metrics['completion_tokens']['status']=='complete' else None,
            'avg_latency_ms':metrics['latency_ms']['known_mean'],'estimated_cost_usd':None,
            'cost_summary':{'known_sum':None,'known_count':0,'unknown_count':len(group),'total_count':len(group),
                            'coverage':0.0,'status':'unknown','basis':'stored_estimate_usd'}})
    html_parts=['<p>14 populated buckets; legacy latency</p>']
    scopes={'selected':[r for r in rows if r['ts'][:10] in days[:14]],
            **{d:[r for r in rows if r['ts'][:10]==d] for d in days[:14]}}
    for scope,group in scopes.items():
        html_parts.append('<section data-measurement-scope="'+scope+'">')
        for metric,stats in summary(group).items():
            attrs=' '.join('data-'+k.replace('_','-')+'="'+('' if v is None else str(v))+'"' for k,v in stats.items())
            text=metric+' '+stats['status'].replace('_',' ')
            if stats['known_sum'] is not None:text+=' Known subtotal '+str(stats['known_sum'])
            if stats['known_mean'] is not None:text+=' Mean of known observations '+str(stats['known_mean'])+' ms'
            text+=f" Coverage {stats['known_count']}/{stats['total_count']} rows Unknown {stats['unknown_count']}"
            html_parts.append(f'<div data-metric="{metric}" {attrs}>{text}</div>')
        html_parts.append('</section>')
    html_parts.append('<div aria-label="Recent usage table"><table>')
    ordered=sorted(rows,key=lambda r:r['id'],reverse=True)
    shown=lambda v:'—' if v is None else str(v)
    for r in ordered[:50]:
        raw=r['reported_usage']
        cells=[r['ts'],r.get('public_model') or '—',r.get('connection_id') or '—','—',
          ' / '.join('—' if r[k] is None else str(r[k])+' ms' for k in ['headers_ms','cli_ready_ms','first_output_ms','total_observed_ms']),
          shown(r['prompt_tokens'])+'/'+shown(r['completion_tokens']),'—',r.get('error') or '',r['outcome'],
          r['usage_status']+' / '+r['usage_source'],' / '.join(shown(raw[k]) for k in check.RAW_FIELDS) if raw else '—']
        html_parts.append('<tr>'+''.join('<td>'+html.escape(c)+'</td>' for c in cells)+'</tr>')
    html_parts.append('</table></div>')
    flat=[]
    for r in rows:
        d={k:v for k,v in r.items() if k!='reported_usage'}
        d.update({'reported_'+k:(r['reported_usage'] or {}).get(k) for k in check.RAW_FIELDS});flat.append(d)
    stream=io.StringIO(); writer=csv.DictWriter(stream,fieldnames=list(flat[0]) if flat else list(row()))
    writer.writeheader();writer.writerows(sorted(flat,key=lambda r:r['id'],reverse=True)[:1000])
    return {'events_rows':ordered[:100],'daily_api':daily,'csv_raw':stream.getvalue(),
            'html_raw':''.join(html_parts)},flat


class SurfaceChecks(unittest.TestCase):
    setUp=PureChecks.setUp

    def test_raw_sql_json_csv_html_and_daily_share_nullable_scope(self):
        rows=[row()]; surfaces,flat=surfaces_fixture(rows)
        check.validate_surfaces(surfaces,rows,flat)
        mutations=[lambda s:s['events_rows'][0].update(prompt_tokens=0),
          lambda s:s.update(csv_raw=s['csv_raw'].replace(',partial,',',complete,')),
          lambda s:s['daily_api']['measurement_summary']['headers_ms'].update(known_sum=0),
          lambda s:s['daily_api']['data'][0].update(prompt_tokens=0),
          lambda s:s.update(html_raw=s['html_raw'].replace('Known subtotal 5','Known subtotal 99',1)),
          lambda s:s.update(html_raw=s['html_raw'].replace('Coverage 0/1 rows','Coverage 1/1 rows',1)),
          lambda s:s.update(html_raw=s['html_raw'].replace('—/5','0/5'))]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(check.CheckFailure):
                bad=copy.deepcopy(surfaces); mutate(bad);check.validate_surfaces(bad,rows,flat)
        flat[0]['reported_cache_read_input_tokens']=0
        with self.assertRaises(check.CheckFailure):check.validate_surfaces(surfaces,rows,flat)

    def test_selected_dates_and_event_limits_are_independent(self):
        rows=[]
        for n in range(105):
            r=row();r.update(id=n+1,attempt_id=f'attempt-{n}',ts=f'2026-09-{n%30+1:02d}T00:00:00Z')
            rows.append(r)
        surfaces,flat=surfaces_fixture(rows)
        check.validate_surfaces(surfaces,rows,flat)
        self.assertEqual(len(surfaces['events_rows']),100)
        changed=copy.deepcopy(surfaces);changed['events_rows'].append(rows[0])
        with self.assertRaises(check.CheckFailure):check.validate_surfaces(changed,rows,flat)
        changed=copy.deepcopy(surfaces);changed['daily_api']['scope']['day_bucket_limit']=14
        with self.assertRaises(check.CheckFailure):check.validate_surfaces(changed,rows,flat)


def report_fixture():
    contract_path=Path(__file__).resolve().parents[1]/'buffered_cli_contract.json'
    contract=json.loads(contract_path.read_text())
    source_names=['buffered_cli_walkthrough.py','buffered_cli_fixture.py','buffered_cli_check.py',
                  'claude_walkthrough.py','claude_fixture.py','offline_walkthrough.py','offline_fixture.py']
    artifacts=[{'role':'binary','path':'/owned/thinrouter','sha256':'b'*64},
               {'role':'runtime','path':'/usr/bin/python3.12','sha256':'a'*64}]
    artifacts += [{'role':('fixture' if n=='buffered_cli_fixture.py' else 'checker' if n=='buffered_cli_check.py'
                    else 'walkthrough' if n=='buffered_cli_walkthrough.py' else 'helper'),
                   'path':'/source/'+n,'sha256':hashlib.sha256(n.encode()).hexdigest()} for n in source_names]
    manifest={'schema_version':1,'artifacts':artifacts,'python_invocation':'/usr/bin/python3',
              'generated_fixture_sha256':'c'*64,'contract_sha256':hashlib.sha256(contract_path.read_bytes()).hexdigest()}
    report={'schema_version':1,'synthetic':True,'mode':'check','journey_status':'passed',
      'real_cli_version':None,'actual_cost_usd':None,'whole_round_metrics':None,
      'binary_sha256':'b'*64,'contract_sha256':manifest['contract_sha256'],
      'source_sha256':{n:hashlib.sha256(n.encode()).hexdigest() for n in source_names},
      'case_inventory':contract['case_inventory'],'stage_inventory':contract['stage_inventory'],
      'cases':[],'phase_trace':[],'sqlite_rows':[],
      'request_trace':[{'sequence':1,'method':'GET','path':'/admin/api/stats','destination':'http://127.0.0.1:39000','kind':'admin'}],
      'owned_listener_ports':[39000,39001],
      'cleanup':dict.fromkeys(['gateway_stopped','owned_children_stopped','fixture_closed','temporary_data_removed','listeners_rebound'],True),
      'isolation':{'status':'passed','no_provider_configuration_before_launch':True,'proof_denied_requests':3,
        'probes':[{'method':'GET','status':403},{'method':'CONNECT','status':403},{'method':'GET','status':403}],
        'owned_home':'/tmp/owned','fake_executable':'/tmp/owned/fake/claude','runtime':'/tmp/owned/fake/runtime',
        'cursor':'/tmp/owned/fake/cursor-agent','fake_sha256':'c'*64,'runtime_sha256':'c'*64,'cursor_sha256':'c'*64,
        'python':'/usr/bin/python3','helper_binary':'/owned/thinrouter','helper_sha256':'b'*64,'proxy':'http://127.0.0.1:39001'}}
    report['cleanup'].update(active_children=0,active_listeners=0)
    all_raw=[]
    for spec in contract['cases']:
        name=spec['name'];case={'name':name,'stage':spec['stage'],'status':'passed','counts':copy.deepcopy(spec['counts']),
                              'rows':[],'phase_trace':[],'raw_events':[],'wire':[]}
        for index,oracle in enumerate(spec['rows']):
            r={k:copy.deepcopy(v) for k,v in oracle.items() if not k.endswith('_present')}
            identifier=len(report['sqlite_rows'])+1
            r.update(id=identifier,ts='2026-10-30T04:00:00Z',attempt_id=f'attempt-{identifier}',
                     request_id=name+f'-request-{index}',finalized_at='2026-10-30T04:00:01Z',
                     public_model=name,connection_id='synthetic-connection',upstream_model=spec['fixture_model'])
            if name.endswith('_fallback'):r['request_id']=name+'-request'
            if name=='claude_resume_retry' and index>0:r['request_id']=name+'-retry'
            r.update(cli_ready_ms=1 if oracle['cli_ready_present'] else None,
                     latency_ms=1 if oracle['cli_ready_present'] else None,
                     first_output_ms=2 if oracle['first_output_present'] else None,
                     total_observed_ms=3 if oracle['total_observed_present'] else None)
            case['rows'].append(r);report['sqlite_rows'].append(r)
        for kind,key in [('spawn','actual_spawns'),('user_input','actual_user_inputs'),('tool_dispatch','actual_tool_dispatches')]:
            for index in range(spec['counts'][key]):
                r=case['rows'][-1] if kind=='tool_dispatch' else case['rows'][min(index,len(case['rows'])-1)]
                pending={k:r[k] for k in ['attempt_id','request_id','public_model','upstream_model','usage_source']}
                event={'sequence':len(report['phase_trace'])+1,'case':name,'kind':kind,'pid':100+identifier,
                       'birth':'12345','model':spec['fixture_model'],'pending_count':1,'pending':[pending],
                       'attempt_id':r['attempt_id'],'request_id':r['request_id']}
                case['phase_trace'].append(event);report['phase_trace'].append(event)
        if any(r['cli_ready_ms'] is not None for r in case['rows']):
            case['raw_events']=[{'case':name,'provider':spec['provider'],'model':spec['fixture_model'],
                                 'event':{'type':'synthetic-event','usage':case['rows'][-1]['reported_usage']}}]
            all_raw+=case['raw_events']
        protocol=next((p for p in ['chat','messages','responses'] if name.endswith('_'+p)),'chat')
        def text_body(text):
            if protocol=='chat':return {'choices':[{'message':{'content':text}}]}
            if protocol=='messages':return {'content':[{'type':'text','text':text}]}
            return {'output':[{'content':[{'type':'output_text','text':text}]}]}
        for status in spec['wire_statuses']:
            item={'status':status,'body':text_body(spec['wire_text']) if status==200 else {'error':{'code':'synthetic'}}}
            if status is None:item.update(body=None,caller_cancelled=True)
            case['wire'].append(item)
            report['request_trace'].append({'sequence':len(report['request_trace'])+1,'method':'POST','path':'/v1/chat/completions',
                                           'destination':'http://127.0.0.1:39000','kind':'client','case':name})
        if spec['fixture_model']=='tool':
            if protocol=='chat':body={'choices':[{'message':{'tool_calls':[{'id':'call-fixture','function':{'name':'add','arguments':'{"a":2,"b":3}'}}]}}]}
            elif protocol=='messages':body={'content':[{'type':'tool_use','id':'call-fixture','name':'add','input':{'a':2,'b':3}}]}
            else:body={'output':[{'type':'function_call','call_id':'call-fixture','name':'add','arguments':'{"a":2,"b":3}'}]}
            case['wire'][0]['body']=body
        if name.endswith('_finalization_restart'):
            first=copy.deepcopy(report['sqlite_rows']);before=copy.deepcopy(first)
            before[-1].update(finalized_at=None,outcome='unknown',error=None)
            counts={'actual_spawns':3,'actual_user_inputs':2,'actual_tool_dispatches':0}
            case['recovery']={'before_rows':before,'after_first_rows':first,'after_second_rows':copy.deepcopy(first),
                             'dispatch_counts_before':counts,'dispatch_counts_after_first':copy.deepcopy(counts),
                             'dispatch_counts_after_second':copy.deepcopy(counts)}
        report['cases'].append(case)
    report['owned_process_identities']=[list(x) for x in sorted({(e['pid'],e['birth']) for e in report['phase_trace']})]
    report['stages']=[{'stage':stage,'status':'passed','case_names':[c['name'] for c in contract['cases'] if c['stage']==stage]}
                      for stage in contract['stage_inventory']]
    keys=contract['cases'][0]['counts'].keys()
    report['counts']={k:sum(c['counts'][k] for c in contract['cases']) for k in keys}
    report['counts'].update(admin_requests=1,selected_reservations=len(report['sqlite_rows']),http_inference=0,refresh=0,
                            discovery=0,unexpected_destinations=0,helper_stdio_rpc_requests=0,helper_callback_http_requests=None)
    surfaces,flat=surfaces_fixture(report['sqlite_rows'])
    surfaces.update(selected_ids=[r['id'] for r in report['sqlite_rows']],filter=None,limits=contract['scope'])
    report.update(surfaces=surfaces,sqlite_original_rows=flat)
    evidence={'trace.jsonl':('\n'.join(json.dumps(e) for e in report['phase_trace'])+'\n').encode(),
              'raw.jsonl':('\n'.join(json.dumps(e) for e in all_raw)+'\n').encode(),'gateway.log':b'synthetic log\n'}
    report['diagnostic_artifacts']={'fake/trace.jsonl':{'path':'trace.jsonl','sha256':hashlib.sha256(evidence['trace.jsonl']).hexdigest()},
                                    'gateway.log':{'path':'gateway.log','sha256':hashlib.sha256(evidence['gateway.log']).hexdigest()}}
    report['raw_log']={'path':'raw.jsonl','sha256':hashlib.sha256(evidence['raw.jsonl']).hexdigest()}
    return report,contract,manifest,evidence


class ReportChecks(unittest.TestCase):
    setUp=PureChecks.setUp

    def test_full_fixed_inventory_passes_as_pure_synthetic_data(self):
        report,contract,manifest,evidence=report_fixture()
        result=check.validate_report(report,contract,manifest,evidence)
        self.assertEqual((result['case_count'],result['stage_count']),(45,9))

    def test_report_rejects_missing_inventory_rows_raw_hash_source_and_cleanup(self):
        mutations=[lambda r:r['cases'].pop(),lambda r:r['stages'].pop(),
          lambda r:r['sqlite_rows'].append(copy.deepcopy(r['sqlite_rows'][0])),
          lambda r:r['sqlite_rows'].pop(),lambda r:r.pop('raw_log'),
          lambda r:r['raw_log'].update(sha256='0'*64),lambda r:r['source_sha256'].pop('buffered_cli_fixture.py'),
          lambda r:r['source_sha256'].update({'buffered_cli_fixture.py':'f'*64}),
          lambda r:r['cleanup'].pop('owned_children_stopped'),lambda r:r['cleanup'].update(active_children=1),
          lambda r:r.update(owner_personal_run_claimed=True),lambda r:r.update(whole_round_metrics={'tokens':0}),
          lambda r:r['isolation'].update(runtime='/usr/bin/cursor-agent'),
          lambda r:r['isolation'].update(proxy='https://provider.invalid'),
          lambda r:r['request_trace'][0].update(destination='http://provider.invalid'),
          lambda r:r['counts'].update(admin_requests=999),lambda r:r['counts'].update(selected_reservations=999),
          lambda r:r.pop('owned_process_identities'),lambda r:r['request_trace'][1].update(case='wrong-case')]
        for mutate in mutations:
            with self.subTest(mutate=mutate),self.assertRaises(check.CheckFailure):
                report,contract,manifest,evidence=report_fixture();mutate(report)
                check.validate_report(report,contract,manifest,evidence)

    def test_reservation_witness_failure_cannot_hide_behind_matching_hash(self):
        report,contract,manifest,evidence=report_fixture()
        report['phase_trace'][0]['pending_count']=0
        evidence['trace.jsonl']=('\n'.join(json.dumps(e) for e in report['phase_trace'])+'\n').encode()
        report['diagnostic_artifacts']['fake/trace.jsonl']['sha256']=hashlib.sha256(evidence['trace.jsonl']).hexdigest()
        with self.assertRaisesRegex(check.CheckFailure,'dispatch_without_reservation'):
            check.validate_report(report,contract,manifest,evidence)

    def test_recovery_replay_and_history_rewrite_are_rejected(self):
        for change in ('replay','history','second'):
            report,contract,manifest,evidence=report_fixture()
            recovery=next(c for c in report['cases'] if c['name']=='claude_finalization_restart')['recovery']
            if change=='replay':recovery['dispatch_counts_after_second']['actual_spawns']+=1
            elif change=='history':recovery['before_rows'][0]['completion_tokens']=999
            else:recovery['after_second_rows'][-1]['finalized_at']='later'
            with self.subTest(change=change),self.assertRaisesRegex(check.CheckFailure,'recovery_'):
                check.validate_report(report,contract,manifest,evidence)

    def test_missing_failed_fallback_attempt_and_changed_parent_are_rejected(self):
        report,contract,manifest,evidence=report_fixture()
        case=next(c for c in report['cases'] if c['name']=='claude_fallback')
        case['rows'].pop(0)
        with self.assertRaisesRegex(check.CheckFailure,'case_attempt_count'):
            check.validate_report(report,contract,manifest,evidence)
        report,contract,manifest,evidence=report_fixture()
        case=next(c for c in report['cases'] if c['name']=='claude_fallback')
        case['rows'][0]['request_id']='other-parent'
        with self.assertRaises(check.CheckFailure):check.validate_report(report,contract,manifest,evidence)

    def test_generated_runtime_pin_and_invocation_mapping_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);manifest=artifact_fixture(root)
            check.verify_artifacts(manifest)
            for change in ({'python_invocation':'/unowned/interpreter'}, {'generated_fixture_sha256':'0'*64}):
                with self.subTest(change=change),self.assertRaises((check.CheckFailure,OSError)):
                    check.verify_artifacts(dict(manifest,**change))

    def test_terminal_cli_digest_failure_stays_pure_and_nonzero(self):
        from contextlib import redirect_stdout
        import io
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);(p/'manifest.json').write_text('{}')
            with redirect_stdout(io.StringIO()):
                code=check.main(['--report',str(p/'report.json'),'--contract',str(p/'contract.json'),
                  '--expected-contract-sha256','0'*64,'--manifest',str(p/'manifest.json'),
                  '--expected-manifest-sha256','0'*64,'--output-dir',str(p/'output')])
            self.assertEqual(code,1)
            self.assertEqual(json.loads((p/'output/buffered-cli-validation.json').read_text())['error_code'],'input_digest_mismatch')


if __name__=='__main__':
    unittest.main()
