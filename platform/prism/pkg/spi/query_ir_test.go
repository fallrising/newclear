package spi

import (
	"reflect"
	"regexp"
	"testing"
)

func TestMatchTypeString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		matchType MatchType
		want      string
	}{
		{matchType: MatchEqual, want: "="},
		{matchType: MatchNotEqual, want: "!="},
		{matchType: MatchRegexp, want: "=~"},
		{matchType: MatchNotRegexp, want: "!~"},
		{matchType: MatchType(255), want: "unknown"},
	}
	for _, test := range tests {
		if got := test.matchType.String(); got != test.want {
			t.Errorf("MatchType(%d).String() = %q, want %q", test.matchType, got, test.want)
		}
	}
}

func TestNewMatcher(t *testing.T) {
	t.Parallel()

	equal, err := NewMatcher(MatchEqual, "job", "api")
	if err != nil || !equal.Matches("api") || equal.Matches("worker") || equal.Compiled != nil {
		t.Fatalf("equal matcher = %#v, %v", equal, err)
	}
	notEqual, err := NewMatcher(MatchNotEqual, "job", "api")
	if err != nil || notEqual.Matches("api") || !notEqual.Matches("worker") {
		t.Fatalf("not-equal matcher = %#v, %v", notEqual, err)
	}
	matching, err := NewMatcher(MatchRegexp, "job", "api|worker")
	if err != nil || !matching.Matches("api") || !matching.Matches("worker") || matching.Matches("api-2") {
		t.Fatalf("anchored regex matcher = %#v, %v", matching, err)
	}
	notMatching, err := NewMatcher(MatchNotRegexp, "job", "api.*")
	if err != nil || notMatching.Matches("api-2") || !notMatching.Matches("worker") {
		t.Fatalf("negative regex matcher = %#v, %v", notMatching, err)
	}

	if _, err := NewMatcher(MatchRegexp, "job", "["); Classify(err) != ErrBadRequest {
		t.Fatalf("invalid regex class = %v, want bad_request", Classify(err))
	}
	if _, err := NewMatcher(MatchType(255), "job", "api"); Classify(err) != ErrBadRequest {
		t.Fatalf("invalid matcher type class = %v, want bad_request", Classify(err))
	}
	if (Matcher{Type: MatchRegexp}).Matches("anything") || (Matcher{Type: MatchNotRegexp}).Matches("anything") {
		t.Fatal("regex matcher without Compiled unexpectedly matched")
	}
}

func TestLineFilterMatches(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		filter LineFilter
		line   string
		want   bool
	}{
		{name: "contains", filter: LineFilter{Op: LineContains, Value: "error"}, line: "an error occurred", want: true},
		{name: "does not contain", filter: LineFilter{Op: LineNotContains, Value: "debug"}, line: "info ready", want: true},
		{name: "regex", filter: LineFilter{Op: LineMatch, Compiled: regexp.MustCompile(`error|warn`)}, line: "warning", want: true},
		{name: "negative regex", filter: LineFilter{Op: LineNotMatch, Compiled: regexp.MustCompile(`debug`)}, line: "info", want: true},
		{name: "nil regex", filter: LineFilter{Op: LineMatch}, line: "anything", want: false},
		{name: "nil negative regex", filter: LineFilter{Op: LineNotMatch}, line: "anything", want: false},
		{name: "invalid operation", filter: LineFilter{Op: LineFilterOp(255)}, line: "anything", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := test.filter.Matches(test.line); got != test.want {
				t.Fatalf("Matches(%q) = %v, want %v", test.line, got, test.want)
			}
		})
	}
}

func TestLogQueryPushdownPlan(t *testing.T) {
	t.Parallel()

	query := LogQuery{
		Filters: []LineFilter{
			{Op: LineContains},
			{Op: LineNotContains},
			{Op: LineMatch},
			{Op: LineNotMatch},
		},
		Stages: []ParseStage{{Kind: ParseJSON}, {Kind: ParseLogfmt}},
		Fields: []FieldFilter{{Field: "status"}},
		Limit:  100,
		Agg:    &LogAggregation{RangeFunc: "count_over_time"},
	}
	full := LogPushdown{
		Substring:         true,
		Regex:             true,
		ParsedFieldJSON:   true,
		ParsedFieldLogfmt: true,
		Limit:             true,
	}
	if plan := query.PushdownPlan(full, true); !plan.AllPushed() {
		t.Fatalf("full PushdownPlan() = %#v, want all pushed", plan)
	}

	partial := query.PushdownPlan(LogPushdown{Substring: true, ParsedFieldJSON: true, Limit: true}, false)
	if want := []bool{true, true, false, false}; !reflect.DeepEqual(partial.Filters, want) {
		t.Fatalf("partial filters = %v, want %v", partial.Filters, want)
	}
	if partial.Stages || partial.Fields || partial.Agg || partial.Limit || partial.AllPushed() {
		t.Fatalf("partial PushdownPlan() = %#v", partial)
	}

	if plan := (LogQuery{}).PushdownPlan(LogPushdown{}, false); !plan.AllPushed() {
		t.Fatalf("empty query PushdownPlan() = %#v, want all vacuous conditions pushed", plan)
	}
	fieldsWithoutParser := LogQuery{Fields: []FieldFilter{{Field: "status"}}}.PushdownPlan(full, true)
	if fieldsWithoutParser.Fields || fieldsWithoutParser.AllPushed() {
		t.Fatalf("fields without parser PushdownPlan() = %#v", fieldsWithoutParser)
	}
}

func TestPushdownPlanAllPushed(t *testing.T) {
	t.Parallel()

	base := PushdownPlan{Selectors: true, TimeRange: true, Filters: []bool{true}, Stages: true, Fields: true, Agg: true, Limit: true}
	if !base.AllPushed() {
		t.Fatal("complete plan was not all pushed")
	}
	tests := []PushdownPlan{
		{TimeRange: true, Stages: true, Fields: true, Agg: true, Limit: true},
		{Selectors: true, Stages: true, Fields: true, Agg: true, Limit: true},
		{Selectors: true, TimeRange: true, Filters: []bool{false}, Stages: true, Fields: true, Agg: true, Limit: true},
		{Selectors: true, TimeRange: true, Stages: false, Fields: true, Agg: true, Limit: true},
		{Selectors: true, TimeRange: true, Stages: true, Fields: false, Agg: true, Limit: true},
		{Selectors: true, TimeRange: true, Stages: true, Fields: true, Agg: false, Limit: true},
		{Selectors: true, TimeRange: true, Stages: true, Fields: true, Agg: true, Limit: false},
	}
	for i, plan := range tests {
		if plan.AllPushed() {
			t.Errorf("plan %d unexpectedly reported all pushed: %#v", i, plan)
		}
	}
}
