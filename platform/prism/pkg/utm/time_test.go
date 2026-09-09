package utm

import (
	"math"
	"strconv"
	"testing"
	"time"
)

func TestTimeConversions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		got  int64
		want int64
	}{
		{name: "nano to micro", got: NanoToMicro(1_999), want: 1},
		{name: "negative nano to micro", got: NanoToMicro(-1_999), want: -1},
		{name: "micro to nano", got: MicroToNano(42), want: 42_000},
		{name: "nano to milli", got: NanoToMilli(1_999_999), want: 1},
		{name: "milli to nano", got: MilliToNano(42), want: 42_000_000},
		{name: "seconds round down", got: SecFloatToMilli(1.2344), want: 1_234},
		{name: "seconds round up", got: SecFloatToMilli(1.2345), want: 1_235},
		{name: "negative follows contract", got: SecFloatToMilli(-1), want: -999},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if test.got != test.want {
				t.Fatalf("got %d, want %d", test.got, test.want)
			}
		})
	}

	if got := MilliToSecFloat(1_234); got != 1.234 {
		t.Fatalf("MilliToSecFloat() = %v, want 1.234", got)
	}
	instant := time.Date(2025, time.March, 4, 5, 6, 7, 8_000_000, time.FixedZone("test", 2*60*60))
	if got := MilliToTime(TimeToMilli(instant)); !got.Equal(instant) || got.Location() != time.UTC {
		t.Fatalf("millisecond conversion = %v (%v), want equivalent UTC time", got, got.Location())
	}
	if got := NanoToTime(TimeToNano(instant)); !got.Equal(instant) || got.Location() != time.UTC {
		t.Fatalf("nanosecond conversion = %v (%v), want equivalent UTC time", got, got.Location())
	}
	if MetricTimeUnit != time.Millisecond || EventTimeUnit != time.Nanosecond {
		t.Fatalf("unexpected timestamp units: metric=%v event=%v", MetricTimeUnit, EventTimeUnit)
	}
}

func TestParsePromTime(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		want    time.Time
		wantErr bool
	}{
		{name: "unix zero", input: "0", want: time.UnixMilli(0).UTC()},
		{name: "unix fractional", input: "1.2345", want: time.UnixMilli(1_235).UTC()},
		{name: "unix negative", input: "-1", want: time.UnixMilli(-999).UTC()},
		{name: "large unix", input: "253402300799", want: time.UnixMilli(253_402_300_799_000).UTC()},
		{name: "RFC3339", input: "2025-03-04T05:06:07+02:00", want: time.Date(2025, 3, 4, 3, 6, 7, 0, time.UTC)},
		{name: "RFC3339Nano", input: "2025-03-04T05:06:07.123456789Z", want: time.Date(2025, 3, 4, 5, 6, 7, 123_456_789, time.UTC)},
		{name: "empty", input: "", wantErr: true},
		{name: "invalid", input: "yesterday", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := ParsePromTime(test.input)
			if (err != nil) != test.wantErr {
				t.Fatalf("ParsePromTime(%q) error = %v, wantErr %v", test.input, err, test.wantErr)
			}
			if !test.wantErr && !got.Equal(test.want) {
				t.Fatalf("ParsePromTime(%q) = %v, want %v", test.input, got, test.want)
			}
			if !test.wantErr && got.Location() != time.UTC {
				t.Fatalf("ParsePromTime(%q) location = %v, want UTC", test.input, got.Location())
			}
		})
	}
}

func TestParseLokiTime(t *testing.T) {
	t.Parallel()

	now := time.Date(2025, 3, 4, 5, 6, 7, 123, time.UTC)
	tests := []struct {
		name    string
		input   string
		want    int64
		wantErr bool
	}{
		{name: "unix zero", input: "0", want: 0},
		{name: "unix negative", input: "-1", want: -1},
		{name: "unix maximum", input: "9223372036854775807", want: math.MaxInt64},
		{name: "RFC3339Nano", input: "2025-03-04T05:06:07.000000123Z", want: now.UnixNano()},
		{name: "relative past", input: "5m", want: now.Add(-5 * time.Minute).UnixNano()},
		{name: "relative future", input: "-1h", want: now.Add(time.Hour).UnixNano()},
		{name: "empty", input: "", wantErr: true},
		{name: "overflow", input: "9223372036854775808", wantErr: true},
		{name: "invalid", input: "soon", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := ParseLokiTime(test.input, now)
			if (err != nil) != test.wantErr {
				t.Fatalf("ParseLokiTime(%q) error = %v, wantErr %v", test.input, err, test.wantErr)
			}
			if !test.wantErr && got != test.want {
				t.Fatalf("ParseLokiTime(%q) = %d, want %d", test.input, got, test.want)
			}
		})
	}
}

func TestParseJaegerTime(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		want    int64
		wantErr bool
	}{
		{name: "zero", input: "0", want: 0},
		{name: "positive", input: "123456", want: 123_456_000},
		{name: "negative", input: "-123456", want: -123_456_000},
		{name: "large", input: "9223372036854775", want: 9_223_372_036_854_775_000},
		{name: "empty", input: "", wantErr: true},
		{name: "decimal", input: "1.5", wantErr: true},
		{name: "overflow", input: "9223372036854775808", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := ParseJaegerTime(test.input)
			if (err != nil) != test.wantErr {
				t.Fatalf("ParseJaegerTime(%q) error = %v, wantErr %v", test.input, err, test.wantErr)
			}
			if !test.wantErr && got != test.want {
				t.Fatalf("ParseJaegerTime(%q) = %d, want %d", test.input, got, test.want)
			}
		})
	}
}

func TestParseJaegerDuration(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input   string
		want    time.Duration
		wantErr bool
	}{
		{input: "", want: 0},
		{input: "100ms", want: 100 * time.Millisecond},
		{input: " 1.5s ", want: 1500 * time.Millisecond},
		{input: "invalid", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			t.Parallel()
			got, err := ParseJaegerDuration(test.input)
			if (err != nil) != test.wantErr {
				t.Fatalf("ParseJaegerDuration(%q) error = %v, wantErr %v", test.input, err, test.wantErr)
			}
			if !test.wantErr && got != test.want {
				t.Fatalf("ParseJaegerDuration(%q) = %v, want %v", test.input, got, test.want)
			}
		})
	}
}

func TestFormatPromValue(t *testing.T) {
	t.Parallel()

	negativeZero := math.Copysign(0, -1)
	tests := []struct {
		name  string
		value float64
		want  string
	}{
		{name: "NaN", value: math.NaN(), want: "NaN"},
		{name: "positive infinity", value: math.Inf(1), want: "+Inf"},
		{name: "negative infinity", value: math.Inf(-1), want: "-Inf"},
		{name: "zero", value: 0, want: "0"},
		{name: "negative zero", value: negativeZero, want: "-0"},
		{name: "smallest", value: math.SmallestNonzeroFloat64, want: strconv.FormatFloat(math.SmallestNonzeroFloat64, 'f', -1, 64)},
		{name: "largest", value: math.MaxFloat64, want: strconv.FormatFloat(math.MaxFloat64, 'f', -1, 64)},
		{name: "integer", value: 1, want: "1"},
		{name: "fraction", value: 1.25, want: "1.25"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := FormatPromValue(test.value); got != test.want {
				t.Fatalf("FormatPromValue(%v) = %q, want %q", test.value, got, test.want)
			}
		})
	}
}
