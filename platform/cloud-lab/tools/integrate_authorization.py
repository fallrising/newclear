#!/usr/bin/env python3
"""Correlate current authorization sources; no deployment or renewal operation."""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


source=load('integration_source',Path(__file__).with_name('collect_authorization.py'))
auth=source.auth
runner=load('integration_runner',Path(__file__).resolve().parents[1]/'adapters/node-health/runner.py')
SCHEMA='cloudlab.authorization-integration.v1'
ROLES=('bot','runner')


class IntegrationError(ValueError):
    """Stable diagnostics without paths, provider data or secrets."""


def require(ok,code='INVALID_INTEGRATION_SOURCE'):
    if not ok:raise IntegrationError(code)


def config_read(path,allow_loopback_http):
    path=auth.files.canonical_path(path)
    auth.files.require_outside_checkout(path)
    # Same strict ancestor/private-file boundary as AS; runner validates loaded semantics.
    auth.files.read_private(path)
    return runner.read_inspection_config(path,allow_loopback_http)


def empty_record(outcome='not_configured'):
    return dict(outcome=outcome,started_at=None,finished_at=None,observed_at=None,config_sha256=None,response_sha256=None)


def collect(profile,request,*,config_paths=None,resident_socket=None,self_client_factory=None,clock=time.time,allow_loopback_http=False):
    """Trusted adapters own I/O bounds. Never accepts a historical snapshot as current."""
    try:
        profile=source.validate_profile(profile)
        paths={} if config_paths is None else config_paths
        require(isinstance(paths,dict) and set(paths)<=set(ROLES),'INVALID_CONFIG_ROLES')
        configs={role:config_read(path,allow_loopback_http) for role,path in paths.items()}
        previous=started=clock()
        require(type(started) in (int,float) and math.isfinite(started) and 0<=started<253402300000,'INVALID_CLOCK')
        def tick():
            nonlocal previous
            now=clock()
            require(type(now) in (int,float) and math.isfinite(now) and previous<=now<=started+120,'COLLECTION_TIME_INVALID')
            previous=now;return now
        bindings={}
        def read(options):
            envelope=request(options)
            if isinstance(envelope,dict) and envelope.get('success') is True:
                result=envelope.get('result')
                if options['path'].endswith('/settings') and configs:
                    require(isinstance(result,dict) and isinstance(result.get('bindings'),list))
                    for role,config in configs.items():
                        for name,expected in [('PUBLIC_ORIGIN',config.base_url),('AUDIENCE',config.audience)]:
                            rows=[b for b in result['bindings'] if isinstance(b,dict) and b.get('name')==name]
                            require(len(rows)==1 and rows[0].get('type')=='plain_text' and rows[0].get('text')==expected,'WORKER_CONTEXT_MISMATCH')
                if '/access/service_tokens/' in options['path'] and isinstance(result,dict):
                    for role,config in configs.items():
                        if options['path'].endswith('/'+profile['service_token_ids'][role]):
                            selected=result.get('client_id');local=getattr(config,'cloudflare_access_client_id',None)
                            if selected is not None and local is not None:
                                require(isinstance(selected,str) and selected==local,'ACCESS_CLIENT_MISMATCH')
                                bindings[role]=True
                            else:bindings[role]=False
            return envelope
        before=source.collect(profile,read,clock=tick)
        first_bindings=dict(bindings)
        snapshot=copy.deepcopy(before['snapshot'])
        subjects={row['role']:row for row in snapshot['subjects']}
        times=[auth.seconds(snapshot['observed_at']),int(started)]
        self_records={role:empty_record() for role in ROLES}
        for role,config in configs.items():
            row=subjects[role];policy=json.loads(row['grant']['policy'])
            require(all(getattr(config,key)==policy[key] for key in ('workspace_id','resource_ref','recipe_ref')),'CONFIG_SCOPE_MISMATCH')
            record=self_records[role]=empty_record('source_rejected')
            record['started_at']=auth.utc(int(tick()));record['config_sha256']=config._loaded_sha256
            try:
                client=self_client_factory(role,config) if self_client_factory else None
                evidence=runner.authorization_observation(config,client,clock=tick)
            except IntegrationError:raise
            except runner.AuthenticationError:
                record['outcome']='authentication_rejected'
            except (runner.ProtocolError,OSError,ValueError):
                pass
            else:
                response=evidence['response'];grant=row['grant']
                expected=dict(id=grant['id'],revision=grant['revision'],principal_id=policy['principal_id'],not_before=policy['not_before'],expires_at=policy['expires_at'])
                require(response['grant']==expected and not grant['revoked'],'SELF_GRANT_CONFLICT')
                require(evidence['config_sha256']==config._loaded_sha256,'SELF_CONFIG_CONFLICT')
                row['credential']=copy.deepcopy(response['credential'])
                record.update(outcome='verified',observed_at=response['observed_at'],response_sha256=source.digest(response))
                times.extend([auth.seconds(evidence['started_at']),auth.seconds(response['observed_at'])])
            record['finished_at']=auth.utc(int(tick()))
        for role in ROLES:
            if not bindings.get(role):subjects[role]['access_service']=None
        resident=empty_record();resident['process_identity_sha256']=None
        if resident_socket is not None and 'runner' in configs:
            resident.update(outcome='self_unavailable',config_sha256=configs['runner']._loaded_sha256)
            if subjects['runner']['credential'] is not None:
                resident.update(outcome='source_rejected',started_at=auth.utc(int(tick())))
                try:
                    evidence=runner.observe_resident_evidence(paths['runner'],resident_socket,allow_loopback_http)
                except (runner.ProtocolError,OSError,ValueError):
                    pass
                else:
                    auth.shape(evidence,'summary started_at config_sha256 process_identity_sha256 response_sha256')
                    summary=evidence['summary'];auth.shape(summary,'source observed_at configured_stop_at runner_stop_at deadline_complete')
                    require(summary['source']=='resident_process' and summary['deadline_complete'] is False)
                    require(evidence['config_sha256']==configs['runner']._loaded_sha256,'RESIDENT_CONFIG_CONFLICT')
                    for key in ('response_sha256','process_identity_sha256'):
                        require(isinstance(evidence[key],str) and re.fullmatch('[a-f0-9]{64}',evidence[key]))
                    now=tick();observed=auth.seconds(summary['observed_at']);began=auth.seconds(evidence['started_at'])
                    require(auth.seconds(resident['started_at'])-1<=began<=observed+1 and began-1<=observed<=now+1 and now-began<=3,'STALE_RESIDENT_SOURCE')
                    require(now<auth.seconds(summary['runner_stop_at'])<=auth.seconds(summary['configured_stop_at']),'INVALID_RESIDENT_DEADLINE')
                    subjects['runner']['runner_stop_at']=summary['runner_stop_at']
                    resident.update(outcome='verified',observed_at=summary['observed_at'],response_sha256=evidence['response_sha256'],process_identity_sha256=evidence['process_identity_sha256'])
                    times.extend([began,observed])
                resident['finished_at']=auth.utc(int(tick()))
        after=source.collect(profile,read,clock=tick)
        def without_time(value):return {k:v for k,v in value.items() if k!='observed_at'}
        require(without_time(before['snapshot'])==without_time(after['snapshot']) and before['provenance']['source_projections']==after['provenance']['source_projections'] and first_bindings==bindings,'MANAGEMENT_DRIFT')
        for role,path in paths.items():
            require(config_read(path,allow_loopback_http)._loaded_sha256==configs[role]._loaded_sha256,'CONFIG_DRIFT')
        finished=tick();snapshot['observed_at']=auth.utc(min(times));auth.validate(snapshot)
        provenance={'schema_version':SCHEMA,'started_at':auth.utc(int(started)),'finished_at':auth.utc(int(finished)),
            'snapshot_sha256':hashlib.sha256(auth.files.encode(snapshot)).hexdigest(),
            'management':[before['provenance'],after['provenance']], 'self':self_records,'resident':resident,
            'access_client_binding':{role:bool(bindings.get(role)) for role in ROLES},
            'worker_context_verified':bool(configs),'route_verified':False,'deployment_version_verified':False,
            'access_policy_verified':False,'atomic_snapshot':False,'business_mutations':False,'nonce_writes_possible':bool(configs)}
        return {'snapshot':snapshot,'provenance':provenance}
    except IntegrationError:raise
    except (source.CollectionError,auth.AuthorizationError,auth.files.PreparationError,runner.ProtocolError,OSError,ValueError,TypeError,KeyError):
        raise IntegrationError('INTEGRATION_SOURCE_UNAVAILABLE_OR_INVALID') from None


def write_collection(profile_path,output_directory,request,**kwargs):
    try:
        path=auth.files.canonical_path(profile_path);destination=auth.files.canonical_path(output_directory)
        for item in (path,destination):auth.files.require_outside_checkout(item)
        profile=source.validate_profile(auth.files.read_private(path))
        parent=auth.files.open_directory(destination.parent)
        try:
            info=os.fstat(parent)
            require(info.st_uid==os.geteuid() and not info.st_mode&0o022,'UNSAFE_OUTPUT_PARENT')
            os.mkdir(destination.name,mode=0o700,dir_fd=parent);os.fsync(parent)
            root=os.open(destination.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
        finally:os.close(parent)
        try:
            result=collect(profile,request,**kwargs)
            payloads={key+'.json':auth.files.encode(result[key]) for key in ('snapshot','provenance')}
            require(all(len(raw)<=32768 for raw in payloads.values()),'OUTPUT_TOO_LARGE')
            manifest={'schema_version':SCHEMA,'complete':True,'files':{name:hashlib.sha256(raw).hexdigest() for name,raw in payloads.items()}}
            payloads['manifest.json']=auth.files.encode(manifest)
            for name,raw in payloads.items():
                fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=root)
                with os.fdopen(fd,'wb') as handle:
                    os.fchmod(handle.fileno(),0o600);handle.write(raw);handle.flush();os.fsync(handle.fileno())
                os.fsync(root)
            return {'saved':True,'applied':False,'snapshot_sha256':manifest['files']['snapshot.json']}
        finally:os.close(root)
    except IntegrationError:raise
    except (source.CollectionError,auth.files.PreparationError,OSError,ValueError):
        raise IntegrationError('PRIVATE_COLLECTION_UNAVAILABLE_OR_UNSAFE') from None


def status(directory,*,now=None):
    try:
        path=auth.files.canonical_path(directory);auth.files.require_outside_checkout(path)
        root=auth.files.open_directory(path)
        try:
            info=os.fstat(root);require(info.st_uid==os.geteuid() and stat.S_IMODE(info.st_mode)==0o700)
            def read(name):
                fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=root)
                with os.fdopen(fd,'rb') as handle:
                    info=os.fstat(handle.fileno())
                    require(stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600)
                    raw=handle.read(32769);return raw,auth.files.strict_json(raw)
            _,manifest=read('manifest.json');auth.shape(manifest,'schema_version complete files')
            require(manifest['schema_version']==SCHEMA and manifest['complete'] is True)
            auth.shape(manifest['files'],'snapshot.json provenance.json')
            parsed={}
            for name,expected in manifest['files'].items():
                raw,value=read(name);require(hashlib.sha256(raw).hexdigest()==expected,'COLLECTION_DIGEST_MISMATCH');parsed[name]=value
            snapshot=parsed['snapshot.json'];provenance=parsed['provenance.json']
            require(provenance['schema_version']==SCHEMA and provenance['snapshot_sha256']==hashlib.sha256(auth.files.encode(snapshot)).hexdigest(),'PROVENANCE_MISMATCH')
            outcomes={'not_configured','authentication_rejected','source_rejected','self_unavailable','verified'}
            records={role:provenance['self'][role]['outcome'] for role in ROLES}
            records['resident']=provenance['resident']['outcome'];require(set(records.values())<=outcomes)
            report=auth.status(snapshot,now=int(time.time()) if now is None else now)
            report['source_outcomes']=records;report['collection_integrity_verified']=True
            return report
        finally:os.close(root)
    except IntegrationError:raise
    except (auth.files.PreparationError,auth.AuthorizationError,OSError,ValueError,KeyError,TypeError):
        raise IntegrationError('PRIVATE_COLLECTION_UNAVAILABLE_OR_INVALID') from None


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    inspect=sub.add_parser('status');inspect.add_argument('--collection',required=True)
    args=parser.parse_args(argv)
    try:
        print(json.dumps(status(args.collection),ensure_ascii=False,sort_keys=True));return 0
    except IntegrationError as error:
        print(str(error),file=sys.stderr);return 2


if __name__=='__main__':sys.exit(main())
