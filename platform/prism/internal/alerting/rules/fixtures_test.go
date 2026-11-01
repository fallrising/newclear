package rules

// ruleFixture is one rule file from 07 §10. ComparePromtool is false for AC-89,
// where Prism rejects a second document and promtool 2.53.0 exits 0.
type ruleFixture struct {
	AC              string
	Name            string
	Body            string
	Accept          bool
	WantErr         string
	ComparePromtool bool
}

func acRuleFixtures() []ruleFixture {
	return []ruleFixture{
		{AC: "AC-72", Name: "host", Body: ac72Host, Accept: true, ComparePromtool: true},
		{AC: "AC-73", Name: "annotations", Body: recordingRule + "        annotations:\n          summary: x\n", Accept: false, WantErr: "invalid field 'annotations' in recording rule", ComparePromtool: true},
		{AC: "AC-73", Name: "for", Body: recordingRule + "        for: 1m\n", Accept: false, WantErr: "invalid field 'for' in recording rule", ComparePromtool: true},
		{AC: "AC-73", Name: "keep_firing_for", Body: recordingRule + "        keep_firing_for: 1m\n", Accept: false, WantErr: "invalid field 'keep_firing_for' in recording rule", ComparePromtool: true},
		{AC: "AC-74", Name: "missing-expr", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n", Accept: false, WantErr: "field 'expr' must be set in rule", ComparePromtool: true},
		{AC: "AC-74", Name: "empty-expr", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: \"\"\n", Accept: false, WantErr: "field 'expr' must be set in rule", ComparePromtool: true},
		{AC: "AC-74", Name: "both", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        record: job:x:rate\n        expr: up\n", Accept: false, WantErr: "only one of 'record' and 'alert' must be set", ComparePromtool: true},
		{AC: "AC-74", Name: "neither", Body: "groups:\n  - name: g\n    rules:\n      - expr: up\n", Accept: false, WantErr: "one of 'record' or 'alert' must be set", ComparePromtool: true},
		{AC: "AC-74", Name: "empty-alert", Body: "groups:\n  - name: g\n    rules:\n      - alert: \"\"\n        expr: up\n", Accept: false, WantErr: "one of 'record' or 'alert' must be set", ComparePromtool: true},
		{AC: "AC-75", Name: "prism-log-expr", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        prism_log_expr: x\n", Accept: false, WantErr: "field prism_log_expr not found in type rulefmt.", ComparePromtool: true},
		{AC: "AC-75", Name: "prism-tenant", Body: "groups:\n  - name: g\n    prism_tenant: t\n    rules:\n      - alert: A\n        expr: up\n", Accept: false, WantErr: "field prism_tenant not found in type rulefmt.", ComparePromtool: true},
		{AC: "AC-75", Name: "extra", Body: "extra: 1\ngroups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n", Accept: false, WantErr: "field extra not found in type rulefmt.", ComparePromtool: true},
		{AC: "AC-75", Name: "partial-response", Body: "groups:\n  - name: g\n    partial_response_strategy: warn\n    rules:\n      - alert: A\n        expr: up\n", Accept: false, WantErr: "field partial_response_strategy not found in type rulefmt.", ComparePromtool: true},
		{AC: "AC-75", Name: "eval-offset", Body: "groups:\n  - name: g\n    eval_offset: 1m\n    rules:\n      - alert: A\n        expr: up\n", Accept: false, WantErr: "field eval_offset not found in type rulefmt.", ComparePromtool: true},
		{AC: "AC-75", Name: "rule-query-offset", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        query_offset: 1m\n", Accept: false, WantErr: "field query_offset not found in type rulefmt.", ComparePromtool: true},
		{AC: "AC-76", Name: "empty-label", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        labels:\n          \"\": bad\n", Accept: false, WantErr: "invalid label name", ComparePromtool: true},
		{AC: "AC-76", Name: "name-label", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        labels:\n          __name__: x\n", Accept: false, WantErr: "invalid label name", ComparePromtool: true},
		{AC: "AC-76", Name: "scalars", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        labels:\n          severity: 1\n          on: true\n          n: 1.5\n", Accept: true, ComparePromtool: true},
		{AC: "AC-76", Name: "extension-label", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        labels:\n          __prism_log_expr__: '{service=\"api\"}'\n", Accept: true, ComparePromtool: true},
		{AC: "AC-77", Name: "duplicate-group", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n  - name: g\n    rules:\n      - alert: B\n        expr: up\n", Accept: false, WantErr: "groupname: \"g\" is repeated in the same file", ComparePromtool: true},
		{AC: "AC-77", Name: "file-a", Body: "groups:\n  - name: same\n    rules:\n      - alert: FromA\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-77", Name: "file-b", Body: "groups:\n  - name: same\n    rules:\n      - alert: FromB\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-78", Name: "bad-promql", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: not promql !!!\n", Accept: false, WantErr: "could not parse expression", ComparePromtool: true},
		{AC: "AC-78", Name: "pipe", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: '{service=\"api\"} | json'\n", Accept: false, WantErr: "unexpected character: '|'", ComparePromtool: true},
		{AC: "AC-78", Name: "selector", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: '{service=\"api\"}'\n", Accept: true, ComparePromtool: true},
		{AC: "AC-79", Name: "unclosed", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        annotations:\n          summary: \"hello {{\"\n", Accept: false, WantErr: "unclosed action", ComparePromtool: true},
		{AC: "AC-79", Name: "template", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        annotations:\n          summary: \"{{ $labels.instance }}\"\n", Accept: true, ComparePromtool: true},
		{AC: "AC-80", Name: "yesterday", Body: "groups:\n  - name: g\n    interval: yesterday\n    rules:\n      - alert: A\n        expr: up\n", Accept: false, WantErr: "not a valid duration string", ComparePromtool: true},
		{AC: "AC-80", Name: "negative-for", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        for: -1s\n", Accept: false, WantErr: "not a valid duration string", ComparePromtool: true},
		{AC: "AC-80", Name: "interval-30s", Body: "groups:\n  - name: g\n    interval: 30s\n    rules:\n      - alert: A\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-80", Name: "for-zero", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        for: 0s\n", Accept: true, ComparePromtool: true},
		{AC: "AC-80", Name: "for-and-keep", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        for: 10m\n        keep_firing_for: 5m\n", Accept: true, ComparePromtool: true},
		{AC: "AC-81", Name: "limit-omit", Body: simpleAlert, Accept: true, ComparePromtool: true},
		{AC: "AC-81", Name: "limit-zero", Body: "groups:\n  - name: g\n    limit: 0\n    rules:\n      - alert: A\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-81", Name: "limit-negative", Body: "groups:\n  - name: g\n    limit: -1\n    rules:\n      - alert: A\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-82", Name: "query-offset", Body: "groups:\n  - name: g\n    query_offset: 1m\n    rules:\n      - alert: A\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-83", Name: "record-1bad", Body: "groups:\n  - name: g\n    rules:\n      - record: \"1bad\"\n        expr: up\n", Accept: false, WantErr: "invalid recording rule name", ComparePromtool: true},
		{AC: "AC-83", Name: "record-utf8", Body: "groups:\n  - name: g\n    rules:\n      - record: \"磁碟:滿\"\n        expr: up\n", Accept: false, WantErr: "invalid recording rule name", ComparePromtool: true},
		{AC: "AC-83", Name: "alert-1bad", Body: "groups:\n  - name: g\n    rules:\n      - alert: \"1bad\"\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-83", Name: "alert-utf8", Body: "groups:\n  - name: g\n    rules:\n      - alert: \"磁碟滿\"\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-84", Name: "merge", Body: ac84Merge, Accept: true, ComparePromtool: true},
		{AC: "AC-88", Name: "annotation", Body: ac88Annotation, Accept: true, ComparePromtool: true},
		{AC: "AC-88", Name: "field", Body: "groups:\n  - name: g\n    rules:\n      - alert: ErrorLogSpike\n        expr: vector(1)\n        prism_log_expr: x\n", Accept: false, WantErr: "field prism_log_expr not found in type rulefmt.RuleNode", ComparePromtool: true},
		{AC: "AC-88", Name: "record-annotation", Body: recordingRule + "        annotations:\n          prism_log_expr: x\n", Accept: false, WantErr: "invalid field 'annotations' in recording rule", ComparePromtool: true},
		{AC: "AC-89", Name: "two-docs", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n---\ngroups:\n  - name: h\n    rules:\n      - alert: B\n        expr: up\n", Accept: false, WantErr: "more than one YAML document"},
		{AC: "AC-89", Name: "trailing-document", Body: simpleAlert + "---\n", Accept: false, WantErr: "more than one YAML document"},
		{AC: "AC-89", Name: "leading-document", Body: "---\n" + simpleAlert, Accept: true},
		{AC: "AC-89", Name: "trailing-dots", Body: simpleAlert + "...\n", Accept: true},
		{AC: "AC-89", Name: "only-document-start", Body: "---\n", Accept: true},
		{AC: "AC-90", Name: "empty", Body: "", Accept: true, ComparePromtool: true},
		{AC: "AC-90", Name: "comment", Body: "# only a comment\n", Accept: true, ComparePromtool: true},
		{AC: "AC-90", Name: "groups-empty", Body: "groups: []\n", Accept: true, ComparePromtool: true},
		{AC: "AC-90", Name: "groups-null", Body: "groups:\n", Accept: true, ComparePromtool: true},
		{AC: "AC-90", Name: "rules-empty", Body: "groups:\n  - name: g\n    rules: []\n", Accept: true, ComparePromtool: true},
		{AC: "AC-91", Name: "interval-omit", Body: simpleAlert, Accept: true, ComparePromtool: true},
		{AC: "AC-91", Name: "interval-zero", Body: "groups:\n  - name: g\n    interval: 0s\n    rules:\n      - alert: A\n        expr: up\n", Accept: true, ComparePromtool: true},
		{AC: "AC-93", Name: "duplicate-alerts", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n      - alert: A\n        expr: up == 1\n", Accept: true, ComparePromtool: true},
		{AC: "AC-93", Name: "duplicate-records", Body: "groups:\n  - name: g\n    rules:\n      - record: job:x:rate\n        expr: up\n        labels:\n          a: b\n      - record: job:x:rate\n        expr: up == 1\n        labels:\n          a: b\n", Accept: true, ComparePromtool: true},
		{AC: "AC-93", Name: "different-labels", Body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n        labels:\n          severity: page\n      - alert: A\n        expr: up == 1\n        labels:\n          severity: warning\n", Accept: true, ComparePromtool: true},
	}
}

const simpleAlert = `groups:
  - name: g
    rules:
      - alert: A
        expr: up
`

const recordingRule = `groups:
  - name: g
    rules:
      - record: job:x:rate
        expr: up
`

const ac72Host = `groups:
  - name: host
    interval: 30s
    limit: 0                 # 該組最大告警數，0 = 無限
    rules:
      - alert: HostDiskAlmostFull
        expr: (1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) > 0.85
        for: 10m
        keep_firing_for: 5m  # 選配，Prometheus 2.42+ 語義
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.instance }} 磁碟使用率 {{ $value | humanizePercentage }}"
          runbook_url: "https://wiki/runbook/disk"
      - record: job:http_requests:rate5m
        expr: sum by (job) (rate(http_requests_total[5m]))
`

const ac84Merge = `groups:
  - name: g
    rules:
      - &base
        alert: First
        expr: up
        labels:
          severity: warning
      - <<: *base
        alert: Second
`

const ac88Annotation = `groups:
  - name: logs
    rules:
      - alert: ErrorLogSpike
        expr: vector(1)
        for: 5m
        labels: {severity: critical}
        annotations:
          prism_log_expr: |
            sum(count_over_time({service="api", level="error"}[5m])) > 100
`
