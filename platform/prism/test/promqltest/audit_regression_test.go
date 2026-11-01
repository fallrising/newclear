package promqltest

import (
	"strings"
	"testing"
)

func TestAudit_IndependentFloatAndClassicHistogram(t *testing.T) {
	input := `load 1m
native {{schema:0 sum:1 count:1 buckets:[1]}}
float 2
classic_bucket{le="1"} 3

` + `eval instant at 0m float
float 2

eval instant at 0m native
native {{schema:0 sum:1 count:1 buckets:[1]}}

eval instant at 0m sum(classic_bucket)
{} 3

eval instant at 0m count({__name__=~"native|float"})
{} 2

clear

load 1m
native 4

eval instant at 0m native
native 4
`
	audit, err := auditCorpus(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(audit.Cases) != 5 {
		t.Fatalf("cases=%d", len(audit.Cases))
	}
	for i, excluded := range []bool{false, true, false, true, false} {
		if (audit.Cases[i].Reason != "") != excluded {
			t.Errorf("case %d: %s", i, audit.Cases[i].Reason)
		}
	}
	if strings.Contains(audit.Input, "{{") {
		t.Fatal("native load retained")
	}
	if !strings.Contains(audit.Input, "classic_bucket") || !strings.Contains(audit.Input, "native 4") {
		t.Fatal("independent float load lost")
	}
}

func TestAudit_FailClosed(t *testing.T) {
	for _, input := range []string{"unknown command", "load 1m\nbad {", "eval instant at 0m sum("} {
		if _, err := auditCorpus(input); err == nil {
			t.Errorf("accepted malformed input %q", input)
		}
	}
}
