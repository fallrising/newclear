import importlib.util,pathlib,tempfile,json,unittest
P=pathlib.Path(__file__).parents[1]/"codex_usage.py"
S=importlib.util.spec_from_file_location("codex_usage",P);m=importlib.util.module_from_spec(S);S.loader.exec_module(m)

class Calculation(unittest.TestCase):
 def test_remaining(self):
  self.assertEqual(m.remaining_percent(20),80);self.assertEqual(m.remaining_percent(-1),100);self.assertEqual(m.remaining_percent(150),0)
 def test_missing_is_null(self):self.assertIsNone(m.remaining_percent(None));self.assertIsNone(m.remaining_percent(True))
 def test_reset(self):
  self.assertEqual(m.reset_seconds(120,100),20);self.assertEqual(m.reset_seconds(90,100),0);self.assertIsNone(m.reset_seconds(None,100))
 def test_window_missing(self):
  w=m.norm_window("primary",{},100);self.assertIsNone(w["used_percent"]);self.assertIsNone(w["remaining_percent"]);self.assertIsNone(w["cycle_tokens"])
 def test_window_calculation(self):
  w=m.norm_window("primary",{"usedPercent":35,"resetsAt":130},100);self.assertEqual(w["remaining_percent"],65);self.assertEqual(w["seconds_until_reset"],30)

class Normalization(unittest.TestCase):
 def test_dedupe_compat(self):
  p={"rateLimitsByLimitId":{"codex":{"limitId":"codex","primary":{"usedPercent":20,"resetsAt":200}}},"rateLimits":{"limitId":"codex","primary":{"usedPercent":20,"resetsAt":200}}}
  b,e=m.normalize_rates(p,100);self.assertEqual(len(b),1);self.assertEqual(e,[])
 def test_distinct_compat(self):
  p={"rateLimitsByLimitId":{"a":{"primary":{"usedPercent":20,"resetsAt":200}}},"rateLimits":{"limitId":"b","primary":{"usedPercent":30,"resetsAt":300}}}
  b,_=m.normalize_rates(p,100);self.assertEqual(len(b),2)
 def test_nonempty_windows(self):
  p={"rateLimitsByLimitId":{"a":{"primary":None,"secondary":{"usedPercent":20,"resetsAt":200}}}}
  b,_=m.normalize_rates(p,100);self.assertEqual([x["name"] for x in b[0]["windows"]],["secondary"])
 def test_cycle_tokens_never_inferred(self):
  u,_=m.normalize_usage({"summary":{"lifetimeTokens":999},"dailyUsageBuckets":[{"startDate":"2026-09-27","tokens":50}]})
  self.assertEqual(u["summary"]["lifetimeTokens"],999);self.assertIsNone(u["cycle_tokens"])
 def test_usage_missing(self):
  u,e=m.normalize_usage(None);self.assertIsNone(u["summary"]);self.assertTrue(e)

class Identity(unittest.TestCase):
 def t(self,**extra):
  x={"expected_email":"a@example.com","use_current_cli_workspace":True};x.update(extra);return x
 def test_match(self):
  x=m.verify_account({"account":{"type":"chatgpt","email":"A@example.com"}},self.t());self.assertTrue(x["account_email_verified"]);self.assertFalse(x["workspace_identity_verified"])
 def test_wrong_account(self):
  with self.assertRaises(m.E):m.verify_account({"type":"chatgpt","email":"x@example.com"},self.t())
 def test_api_key_rejected(self):
  with self.assertRaises(m.E):m.verify_account({"type":"api","email":"a@example.com"},self.t())
 def test_workspace_id_fail_closed(self):
  with self.assertRaises(m.E) as c:m.verify_account({"type":"chatgpt","email":"a@example.com"},self.t(expected_workspace_id="w"))
  self.assertEqual(c.exception.kind,"workspace_identity_unavailable_in_supported_adapter")
 def test_current_workspace_explicit(self):
  with self.assertRaises(m.E):m.verify_account({"type":"chatgpt","email":"a@example.com"},{"expected_email":"a@example.com"})

class Failure(unittest.TestCase):
 def test_cli_missing(self):
  with tempfile.NamedTemporaryFile("w",delete=False) as f:
   json.dump({"expected_email":"a@example.com","use_current_cli_workspace":True},f);name=f.name
  s=m.collect(m.Options(codex="/definitely/missing/codex",target_file=name));self.assertEqual(s["status"],"error");self.assertEqual(s["errors"][0]["kind"],"codex_cli_not_found")
 def test_error_redaction(self):
  self.assertIsNone(m.E("upstream_rpc_error",-1).public()["upstream_message"])

if __name__=="__main__":unittest.main()
