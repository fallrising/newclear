"""Pure report mutations; no binary, subprocess, sockets or provider activity."""
import copy
import csv
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import crash_recovery_check as check
from buffered_cli_check import CheckFailure, expected_measurements


def original(name, pending=False):
    return {'id':2 if pending else 1,'ts':'2026-10-31T10:00:00Z','public_model':name,
        'connection_id':'synthetic-connection','status':None if pending else 200,'latency_ms':None if pending else 1,
        'error':None,'prompt_tokens':None if pending else 5,'completion_tokens':None if pending else 0,
        'estimated_cost_usd':None if pending else 1.25,'request_id':name+'-request','attempt_id':name+'-attempt',
        'upstream_model':name,'finalized_at':None if pending else '2026-10-31T10:00:01Z',
        'headers_ms':None if pending else 1,'first_output_ms':None if pending else 1,
        'total_observed_ms':None if pending else 2,'outcome':'unknown' if pending else 'succeeded',
        'usage_status':'missing' if pending else 'complete','usage_source':check.USAGE_SOURCES[name] if pending else 'openai_chat_v1','cli_ready_ms':None,
        **dict.fromkeys('reported_'+f for f in check.RAW)}


def surface(rows):
    stream=io.StringIO();writer=csv.DictWriter(stream,fieldnames=rows[0]);writer.writeheader();writer.writerows(reversed(rows))
    metrics=expected_measurements(rows)
    day={'day':'2026-10-31','requests':2,'ok':1,'errors':1,'incomplete':0,'unknown':0,'pending':0,'headers_200':sum(r['status']==200 for r in rows),
         'prompt_tokens':None,'completion_tokens':None,'estimated_cost_usd':None,'avg_latency_ms':metrics['latency_ms']['known_mean'],
         'measurement_summary':metrics,'cost_summary':{'known_sum':1.25,'known_count':1,'unknown_count':1,
             'total_count':2,'coverage':0.5,'status':'partial','basis':'stored_estimate_usd'}}
    return {'events_rows':[check.normalize(r) for r in reversed(rows)],'csv_raw':stream.getvalue(),
            'scope':{'selected_ids':[1,2],'filter':None,'events_limit':100,'csv_limit':1000,'day_bucket_limit':30},
            'daily_api':{'schema_revision':2,'measurement_summary':metrics,'data':[day],
                'scope':{'day_bucket_limit':30,'selection':'latest_populated_date_prefix_buckets','denominator':'stored_event_attempt_rows'},
                'basis':{'tokens':'stored_counters_not_subscription_consumption','timing_mean':'known_saved_observations',
                    'latency_ms':'mixed_legacy_and_headers_or_cli_ready_compatibility'}}}


def fixture_report():
    report={'schema_version':1,'status':'passed','synthetic':True,'case_inventory':list(check.CASES),'cases':[],
            'binary_sha256':'a'*64,'source_sha256':{n:'b'*64 for n in check.SOURCES},
            'owner_personal_run_claimed':False,'live_client_version_provider_verified':False,'actual_cost_usd':None,
            'whole_round_metrics':None,'stream_coverage':'existing_native_regression_separate_not_these_cases'}
    def process(pid):return {'pid':pid,'birth':str(pid*10),'state':'S'}
    for name in check.CASES:
        h,p=original('history'),original(name,True)
        recovered=dict(p,finalized_at='2026-10-31T10:01:00Z',outcome='interrupted',usage_status='missing',error='stream_interrupted')
        case={'name':name,'status':'passed','layer':'actual_gateway_http_fakecli','client_protocol':'chat','stream':False,
              'before_kill':[h,p],'after_kill':[copy.deepcopy(h),copy.deepcopy(p)],
              'kill':{'identity':process(92000),'target_pid':92000,'target':'owned_gateway_pid','identity_checked':True,'signal':9,'returncode':-9},
              'receipts_before_kill':[],'restarts':[],'gateway_ports':[20001,20002,20003],
              'isolation':{'proved_before_dispatch':True,'synthetic_home_db':True,'environment_cleared':True,
                  'no_provider_configuration_before_launch':True,'absolute_owned_fake_executables':True,
                  'owned_home':'/synthetic/case','fake_executables':['/synthetic/case/fake/'+n for n in ('claude','cursor-agent','runtime')],
                  'python':'/synthetic/python','python_sha256':'d'*64,'fake_sha256':'e'*64,'fixture_ports':[21001,21002],'proof_denied_requests':3,'denied_requests_final':3,
                  'probes':[{'method':'GET','target':'unknown','status':403},{'method':'CONNECT','target':'connect','status':403},{'method':'GET','target':'redirect','status':403}]},
              'cleanup':{'gateway_stopped':True,'fake_children_stopped':True,'fixture_closed':True,'temporary_data_removed':True,
                  'listeners_released':True,'fake_child_cleanup_basis':'harness_pid_birth_checked_not_product_guarantee'}}
        kinds=['http_inference','http_inference'] if name=='buffered_http' else ['http_inference','spawn','input']
        for index,kind in enumerate(kinds,1):
            row=h if index==1 else p
            receipt={'sequence':index,'kind':kind,'model':row['public_model'],'process':process(90000 if kind=='http_inference' else 91000),
                     'pending':{k:row[k] for k in ('id','request_id','attempt_id','public_model','usage_source')}}
            if kind=='http_inference':receipt.update(destination='http://127.0.0.1:21001/v1/chat/completions',method='POST',auth_valid=True)
            else:receipt['provider']=name.removeprefix('buffered_')
            if kind=='input':receipt['input_basis']='stdin_json_user' if name=='buffered_claude' else 'validated_prompt_argv'
            case['receipts_before_kill'].append(receipt)
        case['receipts_final']=copy.deepcopy(case['receipts_before_kill'])
        children=[] if name=='buffered_http' else [{'pid':91000,'birth':'910000','stopped':True}]
        case['harness_fake_cleanup']=copy.deepcopy(children);case['final_fake_cleanup']=copy.deepcopy(children)
        case['counts']={'http_inference':2 if name=='buffered_http' else 1,'cli_spawn':0 if name=='buffered_http' else 1,'cli_input':0 if name=='buffered_http' else 1,'refresh':0,'discovery':0}
        for index in (1,2):
            rr=copy.deepcopy([h,recovered]);case['restarts'].append({'restart':index,'gateway':process(92000+index),
                'sqlite':rr,'receipts':copy.deepcopy(case['receipts_before_kill']),'surfaces':surface(rr)})
        case['request_trace']=[{'sequence':i,'method':'POST' if i<3 else 'GET','path':'/v1/chat/completions' if i<3 else '/admin/api/usage',
            'destination':'http://127.0.0.1:20001','kind':'client' if i<3 else 'admin'} for i in (1,2,3)]
        case['client_requests']=2;case['admin_requests']=1;report['cases'].append(case)
    return report


def change_pending(case, fields, before=True):
    if before:case['before_kill'][1].update(fields)
    case['after_kill'][1].update(fields)
    for snapshot in case['restarts']:
        snapshot['sqlite'][1].update({k:v for k,v in fields.items() if k not in ('outcome','usage_status')})
        snapshot['surfaces']=surface(snapshot['sqlite'])
    if 'usage_source' in fields:
        for receipts in [case['receipts_before_kill'],case['receipts_final'],*(x['receipts'] for x in case['restarts'])]:
            for receipt in receipts:
                if receipt['model']==case['name']:receipt['pending']['usage_source']=fields['usage_source']


class CrashRecoveryCheckTests(unittest.TestCase):
    def rejects(self,change):
        r=fixture_report();change(r)
        with self.assertRaises((check.InvalidReport,CheckFailure,KeyError,TypeError,ValueError)):
            check.validate_report(r,'a'*64)

    def test_valid_generated_report_and_explicit_zero_partial(self):
        report=fixture_report();self.assertEqual(check.validate_report(report,'a'*64)['cases'],3)
        metric=report['cases'][0]['restarts'][0]['surfaces']['daily_api']['measurement_summary']['completion_tokens']
        self.assertEqual((metric['known_sum'],metric['known_count'],metric['unknown_count'],metric['coverage']),(0,1,1,0.5))

    def test_fixed_case_sources_and_pending_state(self):
        report=fixture_report()
        for case in report['cases']:
            self.assertEqual(case['before_kill'][1]['usage_source'],check.USAGE_SOURCES[case['name']])
            self.assertEqual((case['before_kill'][1]['outcome'],case['before_kill'][1]['usage_status']),('unknown','missing'))
        check.validate_report(report,'a'*64)

    def test_cli_source_cannot_be_http_even_consistently_forged(self):
        for index in (1,2):
            with self.subTest(index=index):self.rejects(lambda r:change_pending(r['cases'][index],{'usage_source':'openai_chat_v1'}))

    def test_http_source_cannot_be_cli(self):
        self.rejects(lambda r:change_pending(r['cases'][0],{'usage_source':'cursor_cli_result_v1'}))

    def test_pending_state_cannot_claim_unknown_quality_or_terminal(self):
        for fields in ({'usage_status':'unknown'},{'outcome':'succeeded'}):
            with self.subTest(fields=fields):self.rejects(lambda r:change_pending(r['cases'][0],fields))

    def test_cli_cannot_inherit_http_status_or_headers(self):
        for index in (1,2):
            with self.subTest(index=index):self.rejects(lambda r:change_pending(r['cases'][index],{'status':200,'headers_ms':0,'latency_ms':0}))

    def test_http_cannot_inherit_cli_ready(self):
        self.rejects(lambda r:change_pending(r['cases'][0],{'cli_ready_ms':0}))

    def test_clock_bool_negative_fraction_rejected(self):
        for value in (False,-1,0.5):
            with self.subTest(value=value):
                report=fixture_report();change_pending(report['cases'][1],{'cli_ready_ms':0,'latency_ms':0})
                for row in (report['cases'][1]['before_kill'][1],report['cases'][1]['after_kill'][1]):row.update(cli_ready_ms=value,latency_ms=value)
                with self.assertRaises(check.InvalidReport):check.validate_report(report,'a'*64)

    def test_status_bool_negative_fraction_rejected(self):
        for value in (False,-1,200.5):
            with self.subTest(value=value):self.rejects(lambda r:change_pending(r['cases'][0],{'status':value,'headers_ms':0,'latency_ms':0}))

    def test_durable_header_and_ready_races_allow_explicit_zero(self):
        report=fixture_report()
        change_pending(report['cases'][0],{'status':200,'headers_ms':0,'latency_ms':0},before=False)
        for case in report['cases'][1:]:change_pending(case,{'cli_ready_ms':0,'latency_ms':0},before=False)
        check.validate_report(report,'a'*64)

    def test_legacy_latency_cannot_change_basis(self):
        self.rejects(lambda r:change_pending(r['cases'][1],{'cli_ready_ms':1,'latency_ms':2}))

    def test_changed_attempt_identity(self):
        self.rejects(lambda r:r['cases'][0]['restarts'][0]['sqlite'][1].update(attempt_id='changed'))

    def test_duplicate_case(self):
        self.rejects(lambda r:r['cases'].append(copy.deepcopy(r['cases'][0])))

    def test_duplicate_row(self):
        self.rejects(lambda r:r['cases'][0]['restarts'][0]['sqlite'].append(copy.deepcopy(r['cases'][0]['restarts'][0]['sqlite'][1])))

    def test_replay_receipt(self):
        self.rejects(lambda r:r['cases'][0]['restarts'][1]['receipts'].append(copy.deepcopy(r['cases'][0]['receipts_before_kill'][-1])))

    def test_replay_after_last_snapshot(self):
        self.rejects(lambda r:r['cases'][0]['receipts_final'].append(copy.deepcopy(r['cases'][0]['receipts_before_kill'][-1])))

    def test_history_changed(self):
        self.rejects(lambda r:r['cases'][1]['restarts'][0]['sqlite'][0].update(estimated_cost_usd=0.0))

    def test_second_recovery_timestamp_changed(self):
        self.rejects(lambda r:r['cases'][2]['restarts'][1]['sqlite'][1].update(finalized_at='later'))

    def test_missing_becomes_zero(self):
        self.rejects(lambda r:r['cases'][0]['restarts'][0]['sqlite'][1].update(completion_tokens=0))

    def test_json_surface_invented_zero(self):
        self.rejects(lambda r:r['cases'][0]['restarts'][0]['surfaces']['events_rows'][0].update(prompt_tokens=0))

    def test_csv_missing_to_zero(self):
        def change(r):
            s=r['cases'][0]['restarts'][0]['surfaces'];reader=csv.DictReader(io.StringIO(s['csv_raw']));rr=list(reader);rr[0]['prompt_tokens']='0'
            stream=io.StringIO();writer=csv.DictWriter(stream,fieldnames=reader.fieldnames);writer.writeheader();writer.writerows(rr);s['csv_raw']=stream.getvalue()
        self.rejects(change)

    def test_excluded_interrupted_denominator(self):
        self.rejects(lambda r:r['cases'][0]['restarts'][0]['surfaces']['daily_api']['data'][0].update(requests=1))

    def test_partial_cost_as_complete_total(self):
        self.rejects(lambda r:r['cases'][0]['restarts'][0]['surfaces']['daily_api']['data'][0].update(estimated_cost_usd=1.25))

    def test_false_sigkill(self):
        self.rejects(lambda r:r['cases'][0]['kill'].update(returncode=0))

    def test_kill_wrong_target(self):
        self.rejects(lambda r:r['cases'][0]['kill'].update(target='process_group'))

    def test_cleanup_failure(self):
        self.rejects(lambda r:r['cases'][1]['cleanup'].update(fake_children_stopped=False))

    def test_fake_cleanup_is_not_product_guarantee(self):
        self.rejects(lambda r:r['cases'][1]['cleanup'].update(fake_child_cleanup_basis='product'))

    def test_child_cleanup_identity_missing(self):
        self.rejects(lambda r:r['cases'][1].update(harness_fake_cleanup=[]))

    def test_fake_executable_escapes_home(self):
        self.rejects(lambda r:r['cases'][1]['isolation']['fake_executables'].__setitem__(0,'/usr/bin/claude'))

    def test_dispatch_missing(self):
        self.rejects(lambda r:r['cases'][2]['receipts_before_kill'].pop())

    def test_pending_not_committed_at_receipt(self):
        self.rejects(lambda r:r['cases'][1]['receipts_before_kill'][-1]['pending'].update(attempt_id='missing'))

    def test_unknown_destination(self):
        self.rejects(lambda r:r['cases'][0]['receipts_before_kill'][0].update(destination='https://example.com/v1/chat/completions'))

    def test_proof_denial_extra_request(self):
        self.rejects(lambda r:r['cases'][0]['isolation'].update(denied_requests_final=4))

    def test_owner_or_live_claim(self):
        for key in ('owner_personal_run_claimed','live_client_version_provider_verified'):
            with self.subTest(key=key):self.rejects(lambda r:r.update({key:True}))

    def test_source_and_binary_pins(self):
        r=fixture_report()
        with self.assertRaises(check.InvalidReport):check.validate_report(r,'c'*64)
        with self.assertRaises(check.InvalidReport):check.validate_report(r,'a'*64,{n:'c'*64 for n in check.SOURCES})

    def test_duplicate_json_nonfinite_rejected(self):
        for raw in ('{"x":1,"x":2}','{"x":NaN}','{"x":Infinity}'):
            with self.subTest(raw=raw),self.assertRaises(check.InvalidReport):check.loads(raw)

    def test_cleanup_attempts_fixture_after_gateway_stop_error(self):
        import crash_recovery_walkthrough as journey
        with tempfile.TemporaryDirectory() as root:
            output=Path(root);f=mock.Mock();f._servers=[];f.closed=True
            g=mock.Mock();g.ports=[];g.trace=[]
            g.start.side_effect=check.InvalidReport('injected_start_failure')
            g.stop.side_effect=check.InvalidReport('injected_stop_failure')
            records=[]
            with mock.patch.object(journey,'Fixture',return_value=f),mock.patch.object(journey,'Gateway',return_value=g),mock.patch.object(journey,'prove',return_value={}),mock.patch.object(journey,'cleanup_fake',return_value=[]),mock.patch('subprocess.Popen',side_effect=AssertionError('no process')),mock.patch('socket.socket',side_effect=AssertionError('no network')):
                with self.assertRaises(check.InvalidReport):journey.run_case(Path('/synthetic/binary'),'buffered_http',output,lambda r:records.append(copy.deepcopy(r)))
            f.close.assert_called_once()
            self.assertFalse(records[-1]['cleanup']['gateway_stopped'])
            self.assertTrue(records[-1]['cleanup']['fixture_closed'])
            self.assertFalse(records[-1]['cleanup']['temporary_data_removed'])

    def test_checker_has_no_runtime_calls(self):
        with mock.patch('subprocess.Popen',side_effect=AssertionError('no process')),mock.patch('socket.socket',side_effect=AssertionError('no network')):
            check.validate_report(fixture_report(),'a'*64)


if __name__=='__main__':unittest.main()
