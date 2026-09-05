package utm

import (
	"testing"

	"github.com/prometheus/prometheus/model/labels"
)

func TestSanitizeMetricName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input string
		want  string
	}{
		{input: "", want: ""},
		{input: "http_requests_total", want: "http_requests_total"},
		{input: "http:requests", want: "http:requests"},
		{input: "9lives", want: "_9lives"},
		{input: "http.requests-total", want: "http_requests_total"},
		{input: "溫度.celsius", want: "___celsius"},
	}
	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			t.Parallel()
			got := SanitizeMetricName(test.input)
			if got != test.want {
				t.Fatalf("SanitizeMetricName(%q) = %q, want %q", test.input, got, test.want)
			}
			if again := SanitizeMetricName(got); again != got {
				t.Fatalf("SanitizeMetricName is not idempotent: %q then %q", got, again)
			}
		})
	}
}

func TestSanitizeLabelName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input string
		want  string
	}{
		{input: "", want: ""},
		{input: "service_name", want: "service_name"},
		{input: "9lives", want: "_9lives"},
		{input: "service.name", want: "service_name"},
		{input: "metric:label", want: "metric_label"},
		{input: "服務.name", want: "___name"},
	}
	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			t.Parallel()
			got := SanitizeLabelName(test.input)
			if got != test.want {
				t.Fatalf("SanitizeLabelName(%q) = %q, want %q", test.input, got, test.want)
			}
			if again := SanitizeLabelName(got); again != got {
				t.Fatalf("SanitizeLabelName is not idempotent: %q then %q", got, again)
			}
		})
	}
}

func TestReservedLabels(t *testing.T) {
	t.Parallel()

	if LabelTenant != "__tenant__" || LabelName != "__name__" || LabelSeverity != "__severity__" {
		t.Fatal("system label constants changed")
	}
	for _, name := range []string{"__name__", "__", "___custom"} {
		if !IsReserved(name) {
			t.Errorf("IsReserved(%q) = false, want true", name)
		}
	}
	for _, name := range []string{"", "_name", "name__"} {
		if IsReserved(name) {
			t.Errorf("IsReserved(%q) = true, want false", name)
		}
	}
}

func TestFingerprint(t *testing.T) {
	t.Parallel()

	ls := labels.FromStrings("instance", "api-1", "job", "api")
	if got := Fingerprint(ls); got == 0 || got != ls.Hash() {
		t.Fatalf("Fingerprint() = %d, labels.Hash() = %d", got, ls.Hash())
	}
}
