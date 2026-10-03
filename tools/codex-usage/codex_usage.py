#!/usr/bin/env python3
"""Stateless read-only Codex ChatGPT subscription usage collector."""
from __future__ import annotations
import argparse,datetime as dt,json,math,os,selectors,shutil,signal,subprocess,time
from dataclasses import dataclass

VERSION="1.0.0"; ACCOUNT="account/read"; RATE="account/rateLimits/read"; USAGE="account/usage/read"
CYCLE_REASON="No complete token total aligned to this quota window was provided; daily/lifetime tokens and quota percentages are not substituted."

class E(Exception):
 def __init__(self,kind,code=None): self.kind,self.code=kind,code
 def public(self): return {"kind":self.kind,"rpc_code":self.code,"upstream_message":None}

def number(v): return v if type(v) in (int,float) and math.isfinite(v) else None
def integer(v): return v if type(v) is int and v>=0 else None
def remaining_percent(v):
 v=number(v); return None if v is None else max(0,min(100,100-v))
def reset_seconds(v,now):
 v=integer(v); return None if v is None else max(0,v-now)
def iso(v):
 v=integer(v)
 if v is None:return None
 try:return dt.datetime.fromtimestamp(v,dt.timezone.utc).isoformat().replace("+00:00","Z")
 except (ValueError,OverflowError,OSError):return None
def q(status="not_attempted",err=None):
 return {"status":status,"source_updated_at":None,"source_update_time_status":"unknown","error":err.public() if err else None}

@dataclass(frozen=True)
class Options:
 codex:str="codex"; codex_home:str|None=None; target_file:str|None=None; timeout:float=10.0

class RPC:
 def __init__(self,argv,env):
  try:self.p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,bufsize=0,start_new_session=True)
  except OSError:raise E("process_start_failed") from None
  os.set_blocking(self.p.stdout.fileno(),False);self.sel=selectors.DefaultSelector();self.sel.register(self.p.stdout,selectors.EVENT_READ);self.buf=bytearray();self.n=1
 def send(self,x):self.p.stdin.write((json.dumps(x,separators=(",",":"))+"\n").encode());self.p.stdin.flush()
 def recv(self,deadline):
  while True:
   i=self.buf.find(b"\n")
   if i>=0:
    raw=bytes(self.buf[:i]);del self.buf[:i+1]
    try:x=json.loads(raw)
    except Exception:raise E("invalid_protocol_json") from None
    if not isinstance(x,dict):raise E("invalid_protocol_envelope")
    return x
   left=deadline-time.monotonic()
   if left<=0 or not self.sel.select(left):raise E("rpc_timeout")
   chunk=os.read(self.p.stdout.fileno(),65536)
   if not chunk:raise E("process_stdout_closed")
   self.buf.extend(chunk)
   if len(self.buf)>16*1024*1024:raise E("protocol_line_limit_exceeded")
 def call(self,method,params,timeout):
  rid=self.n;self.n+=1;self.send({"jsonrpc":"2.0","id":rid,"method":method,"params":params});deadline=time.monotonic()+timeout
  while True:
   x=self.recv(deadline)
   if x.get("id")!=rid:continue
   if "error" in x:
    er=x["error"] if isinstance(x["error"],dict) else {};code=er.get("code") if type(er.get("code")) is int else None;s=str(er.get("message","")).lower()
    kind="authentication_failed_or_expired" if code in (401,403) or "auth" in s or "login" in s else "method_unsupported" if code==-32601 or "method not found" in s else "upstream_rpc_error"
    raise E(kind,code)
   return x.get("result")
 def notify(self,m,p):self.send({"jsonrpc":"2.0","method":m,"params":p})
 def close(self):
  try:self.p.stdin.close()
  except OSError:pass
  try:self.p.wait(timeout=1)
  except subprocess.TimeoutExpired:
   try:os.killpg(self.p.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   try:self.p.wait(timeout=2)
   except subprocess.TimeoutExpired:
    try:os.killpg(self.p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    self.p.wait(timeout=2)

def load_target(path):
 if not path:raise E("target_required")
 try:
  with open(path,encoding="utf-8") as f:x=json.load(f)
 except (OSError,json.JSONDecodeError):raise E("target_file_invalid") from None
 if not isinstance(x,dict) or not isinstance(x.get("expected_email"),str):raise E("target_file_invalid")
 return x

def verify_account(payload,target):
 a=payload.get("account",payload) if isinstance(payload,dict) else None
 if not isinstance(a,dict):raise E("account_response_invalid")
 if a.get("type") not in ("chatgpt","ChatGPT"):raise E("chatgpt_subscription_auth_required")
 if not isinstance(a.get("email"),str) or a["email"].casefold()!=target["expected_email"].casefold():raise E("target_account_mismatch")
 if target.get("expected_workspace_id") is not None:raise E("workspace_identity_unavailable_in_supported_adapter")
 if target.get("use_current_cli_workspace") is not True:raise E("current_cli_workspace_not_authorized")
 return {"account_type":"chatgpt","account_email_verified":True,"workspace_identity_verified":False,"workspace_selection":"current_cli_workspace"}

def norm_window(name,x,now):
 x=x if isinstance(x,dict) else {};used=x.get("usedPercent");reset=x.get("resetsAt")
 return {"name":name,"used_percent":number(used),"remaining_percent":remaining_percent(used),"window_duration_minutes":integer(x.get("windowDurationMins")),"resets_at_unix":integer(reset),"resets_at":iso(reset),"seconds_until_reset":reset_seconds(reset,now),"source_updated_at":None,"cycle_tokens":None,"cycle_tokens_reason":CYCLE_REASON}

def normalize_rates(payload,now):
 if not isinstance(payload,dict):return None,["rate_limits_payload_invalid"]
 indexed=payload.get("rateLimitsByLimitId");compat=payload.get("rateLimits");items=[];seen=set()
 if isinstance(indexed,dict):items=list(indexed.items())
 elif isinstance(compat,dict):items=[(compat.get("limitId"),compat)]
 else:return None,["rate_limit_data_missing"]
 out=[]
 for key,raw in items:
  if not isinstance(raw,dict):continue
  ident=key or raw.get("limitId")
  if isinstance(ident,str) and ident in seen:continue
  if isinstance(ident,str):seen.add(ident)
  wins=[]
  for name,v in raw.items():
   if isinstance(v,dict) and v is not None and any(k in v for k in ("usedPercent","resetsAt","windowDurationMins")):wins.append(norm_window(name,v,now))
  if wins:out.append({"bucket":ident if isinstance(ident,str) and len(ident)<80 else None,"limit_name":raw.get("limitName") if isinstance(raw.get("limitName"),str) and len(raw["limitName"])<80 else None,"windows":wins})
 # compatibility object is only added if its identity is distinct
 if isinstance(indexed,dict) and isinstance(compat,dict):
  ident=compat.get("limitId")
  if isinstance(ident,str) and ident not in seen:
   extra,_=normalize_rates({"rateLimits":compat},now);out.extend(extra or [])
 return out,[]

def normalize_usage(payload):
 if not isinstance(payload,dict):return {"summary":None,"daily_usage_buckets":None,"cycle_tokens":None,"cycle_tokens_reason":CYCLE_REASON},["usage_payload_invalid"]
 summary=payload.get("summary");daily=payload.get("dailyUsageBuckets")
 safe_summary=None
 if isinstance(summary,dict):
  safe_summary={k:integer(summary.get(k)) for k in ("lifetimeTokens","peakDailyTokens","longestRunningTurnSec","currentStreakDays","longestStreakDays")}
 safe_daily=None
 if isinstance(daily,list):safe_daily=[{"start_date":r.get("startDate") if isinstance(r,dict) and isinstance(r.get("startDate"),str) else None,"tokens":integer(r.get("tokens")) if isinstance(r,dict) else None} for r in daily]
 return {"scope":"account_activity_not_quota_cycle","summary":safe_summary,"daily_usage_buckets":safe_daily,"source_updated_at":None,"cycle_tokens":None,"cycle_tokens_reason":CYCLE_REASON},[]

def collect(o):
 started=time.monotonic();out={"snapshot_schema_version":"1.0","collector_version":VERSION,"status":"error","collection_started_at":dt.datetime.now(dt.timezone.utc).isoformat(),"collected_at":None,"source":{"kind":"official_codex_cli_app_server","codex_version":None},"identity":None,"queries":{"account":q(),"rate_limits":q(),"usage":q()},"quota_buckets":None,"token_statistics":None,"errors":[]}
 exe=shutil.which(o.codex) if os.sep not in o.codex else o.codex
 if not exe or not os.path.isfile(exe) or not os.access(exe,os.X_OK):
  out["errors"].append(E("codex_cli_not_found").public());out["collected_at"]=dt.datetime.now(dt.timezone.utc).isoformat();return out
 env=os.environ.copy()
 if o.codex_home:env["CODEX_HOME"]=o.codex_home
 target=load_target(o.target_file);rpc=None
 try:
  try:
   v=subprocess.run([exe,"--version"],capture_output=True,text=True,timeout=5,env=env);out["source"]["codex_version"]=v.stdout.strip()[:120] if v.returncode==0 else None
  except Exception:pass
  rpc=RPC([exe,"app-server"],env);rpc.call("initialize",{"clientInfo":{"name":"codex-usage","version":VERSION},"capabilities":{}},o.timeout);rpc.notify("initialized",{})
  a=rpc.call(ACCOUNT,{"refreshToken":False},o.timeout);out["queries"]["account"]=q("ok");out["identity"]=verify_account(a,target)
  for method,key in ((RATE,"rate_limits"),(USAGE,"usage")):
   try:
    x=rpc.call(method,{},o.timeout);out["queries"][key]=q("ok")
    if method==RATE:out["quota_buckets"],issues=normalize_rates(x,int(time.time()))
    else:out["token_statistics"],issues=normalize_usage(x)
    if issues:out["queries"][key]["status"]="partial";out["queries"][key]["field_issues"]=issues
   except E as e:out["queries"][key]=q("error",e)
  verify_account(rpc.call(ACCOUNT,{"refreshToken":False},o.timeout),target)
  states=[out["queries"][k]["status"] for k in ("rate_limits","usage")]
  out["status"]="ok" if states==["ok","ok"] else "partial" if any(x in ("ok","partial") for x in states) else "error"
 except E as e:out["errors"].append(e.public())
 finally:
  if rpc:rpc.close()
  out["collected_at"]=dt.datetime.now(dt.timezone.utc).isoformat();out["collection_duration_ms"]=round((time.monotonic()-started)*1000,3)
 return out

get_codex_usage_snapshot=collect

def main():
 p=argparse.ArgumentParser();p.add_argument("--codex",default="codex");p.add_argument("--codex-home");p.add_argument("--target-file",required=True);p.add_argument("--timeout",type=float,default=10.0);a=p.parse_args()
 s=collect(Options(a.codex,a.codex_home,a.target_file,a.timeout));print(json.dumps(s,ensure_ascii=False,indent=2,allow_nan=False))
 return 0 if s["status"]=="ok" else 2 if s["status"]=="partial" else 1
if __name__=="__main__":raise SystemExit(main())
