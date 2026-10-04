"""psql adapter for the isolated lab database; no live provider configuration."""
import base64
import json
import os
import subprocess
from policy import RISK_CONDITION, ROUTE_QUESTION

SETTINGS = """
SET statement_timeout = '1500ms';
SET jev.api_url = 'http://127.0.0.1:8765/v1/systemone';
SET jev.model = 'fixture-not-jev';
SET jev.notices = 'off';
SET jev.batch_size = '1';
SET jev.concurrency = '1';
SET jev.max_rows_per_statement = '2';
SET jev.max_chars_per_statement = '16384';
SET jev.timeout = '0.5';
"""


def sql_text(text):
    # Base64 alphabet excludes quotes, backslashes and psql metacommands.
    encoded = base64.b64encode(text.encode()).decode()
    return "convert_from(decode('" + encoded + "', 'base64'), 'UTF8')"


def psql(sql):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGCONNECT_TIMEOUT": "2"}
    try:
        r = subprocess.run(
            ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
             "-U", "lab_reader", "-d", "postgres"], input=sql, text=True,
            capture_output=True, timeout=8, env=env, check=False)
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("lab query timed out") from exc
    if r.returncode:
        # No upstream body, SQL, text or credential in caller-facing errors.
        raise OSError("lab query failed")
    return r.stdout.strip().splitlines()


def evaluate(text):
    # Anonymous projected record: no base-table prefetch or cross-user rows.
    sql = SETTINGS + """
SELECT jsonb_build_object(
 'risk', jev_eval(m, %s, 'noul'),
 'route', jev_eval(m, %s, 'choice', ARRAY['small','coding','reasoning']))
FROM (SELECT %s AS text OFFSET 0) m;
""" % (sql_text(RISK_CONDITION), sql_text(ROUTE_QUESTION), sql_text(text))
    return json.loads(psql(sql)[0])
