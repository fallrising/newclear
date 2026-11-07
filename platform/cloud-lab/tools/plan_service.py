#!/usr/bin/env python3
"""Offline, non-executable service activation proposals; no provider or service calls."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


auth=load('service_plan_authorization',Path(__file__).with_name('authorization.py'))
runner=load('service_plan_runner',Path(__file__).resolve().parents[1]/'adapters/node-health/runner.py')


class PlanError(ValueError):
    """Fixed diagnostics; never include input contents or private paths."""


def require(ok,code='INVALID_SERVICE_PROPOSAL'):
    if not ok:raise PlanError(code)


def make_plan(snapshot,config_value,*,days,poll_seconds,now):
    try:
        auth.integer(days,1,7);auth.integer(poll_seconds,5,60)
        report=auth.status(snapshot,now=now)
        require(report['snapshot_age_seconds']>=0,'FUTURE_OBSERVATION')
        require(snapshot['active_commands']==0 and not snapshot['schedules_enabled'],'QUIESCENT_SOURCE_REQUIRED')
        config=runner.Config.from_dict(config_value)
        require(config._access_client_secret is not None,'ACCESS_CONFIGURATION_REQUIRED')
        subject=next((x for x in snapshot['subjects'] if x['role']=='runner'),None)
        require(subject is not None and subject['grant'] is not None,'RUNNER_GRANT_REQUIRED')
        grant=subject['grant'];policy=auth.files.strict_json(grant['policy'].encode())
        require(not grant['revoked'],'REVOKED_SOURCE')
        require(auth.seconds(policy['not_before'])<=now,'GRANT_NOT_YET_VALID')
        require(set(policy['capabilities'])==auth.CAPABILITIES['runner'],'RUNNER_CAPABILITIES_REQUIRED')
        require(all(policy[key]==getattr(config,key) for key in ('workspace_id','resource_ref','recipe_ref')),'CONFIG_SCOPE_MISMATCH')
        credential=subject['credential'];access=subject['access_service']
        require(subject['access_required'],'ACCESS_SOURCE_REQUIRED')
        if credential is not None:
            require(not credential['revoked'],'REVOKED_SOURCE')
            require(credential['id']==config.credential_id and credential['generation']==config.generation,'CONFIG_CREDENTIAL_MISMATCH')
        if access is not None:require(not access['revoked'],'REVOKED_SOURCE')
        current=next(x for x in report['subjects'] if x['role']=='runner')
        unknown=[key for key,value in current['layers'].items() if value['state']=='unknown']
        shared=sorted(x['role'] for x in snapshot['subjects'] if access is not None and
                      x['access_service'] is not None and x['access_service']['id']==access['id'])
        duration=days*86400
        cycles=(duration+poll_seconds-1)//poll_seconds
        return {
            'schema_version':'cloudlab.service-activation-plan.v1',
            'created_at':auth.utc(now),'observed_at':snapshot['observed_at'],
            'snapshot_fresh':report['snapshot_fresh'],'snapshot_sha256':hashlib.sha256(auth.files.encode(snapshot)).hexdigest(),
            'config_sha256':hashlib.sha256(runner.encode(config_value)).hexdigest(),
            'target':copy.deepcopy(snapshot['target']),
            'runner':{'grant_id':grant['id'],'grant_revision':grant['revision'],
                      'credential_id':config.credential_id,'credential_generation':config.generation,
                      'scope':{key:copy.deepcopy(policy[key]) for key in ('workspace_id','resource_ref','recipe_ref','capabilities')}},
            'before':current,'unknown_layers':unknown,'shared_access_roles':shared,
            'access_client_binding_verified':False,'renew_roles':['runner'],
            'approval_required':True,'applied':False,'activation_ready':False,
            'requires_recollection_before_activation':True,'t0':None,'poll_seconds':poll_seconds,
            'offsets_seconds':{'service_until':duration,'runner_grant_until':duration+600,
                               'runner_hmac_until':duration+600,'access_until':duration+1200},
            'estimate':{'duration_seconds':duration,'idle_claims_per_24h':(86400+poll_seconds-1)//poll_seconds,
                        'single_start_idle_requests':cycles+1,'single_start_all_cycles_report_requests':2*cycles+1,
                        'self_requests_per_start':1,'d1_rows_read':None,'d1_rows_written':None,'bill':None,
                        'assumptions':['one uninterrupted process; cycles take zero time; no transient failures',
                                       'one startup self request; at most one report per cycle',
                                       'restarts, operator/bot/dashboard traffic and other account usage excluded',
                                       'not an enforced quota or billing guarantee; D1 indexes/row scans must be measured']},
            'activation_checks':['approve target, runner-only renewals, shared Access extension and exact offsets',
                                 'freshly verify deployment, Access policy/client binding, key identity and unchanged scope',
                                 'verify inactive service, free journal lock, completed/reconciled journal, active0 and schedules off',
                                 'verify account Free plan and current usage; no paid upgrade',
                                 'persist T0 and request/readback receipts; reconcile unknown results, never replay blindly',
                                 'materialize runtime policy only from actual verified expirations and unchanged config',
                                 'verify startup self and resident; routine resident remains active until cutoff or explicit stop']}
    except (auth.AuthorizationError,auth.files.PreparationError,runner.ProtocolError,TypeError,ValueError,OverflowError) as error:
        if isinstance(error,PlanError):raise
        raise PlanError('INVALID_SERVICE_PROPOSAL') from error


def run(snapshot_path,config_path,output_path,*,days,poll_seconds,now=None):
    try:
        source,config,destination=(auth.files.canonical_path(p) for p in (snapshot_path,config_path,output_path))
        for path in (source,config,destination):auth.files.require_outside_checkout(path)
        plan=make_plan(auth.files.read_private(source),auth.files.read_private(config),days=days,
                       poll_seconds=poll_seconds,now=int(time.time()) if now is None else now)
        raw=auth.files.encode(plan)
        require(len(raw)<=32768,'PROPOSAL_TOO_LARGE')
        parent=auth.files.open_directory(destination.parent)
        try:
            info=os.fstat(parent)
            require(info.st_uid==os.geteuid() and not info.st_mode&0o022,'UNSAFE_OUTPUT_PARENT')
            fd=os.open(destination.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
            with os.fdopen(fd,'wb') as handle:
                os.fchmod(handle.fileno(),0o600);handle.write(raw);handle.flush();os.fsync(handle.fileno())
            os.fsync(parent)
        finally:os.close(parent)
        return {'saved':True,'applied':False,'sha256':hashlib.sha256(raw).hexdigest()}
    except (OSError,auth.files.PreparationError) as error:
        raise PlanError('PRIVATE_FILE_UNAVAILABLE_OR_UNSAFE') from error


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('snapshot','config','output'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--days',type=int,required=True)
    parser.add_argument('--poll-seconds',type=int,required=True)
    args=parser.parse_args(argv)
    try:
        print(json.dumps(run(args.snapshot,args.config,args.output,days=args.days,poll_seconds=args.poll_seconds)))
        return 0
    except PlanError:
        print('service proposal unavailable',file=sys.stderr)
        return 1


if __name__=='__main__':sys.exit(main())
