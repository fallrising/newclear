package secret

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

type yamlMarshaler interface {
	MarshalYAML() (any, error)
}

var (
	_ fmt.Stringer   = String("")
	_ fmt.Formatter  = String("")
	_ json.Marshaler = String("")
	_ yamlMarshaler  = String("")
)

func TestStringSerializationIsRedacted(t *testing.T) {
	const plaintext = "api-key-do-not-disclose"
	value := String(plaintext)

	jsonOutput, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	marshalJSONOutput, err := value.MarshalJSON()
	if err != nil {
		t.Fatalf("MarshalJSON() error = %v", err)
	}
	if got, want := string(marshalJSONOutput), `"<secret>"`; got != want {
		t.Errorf("MarshalJSON() = %q, want %q", got, want)
	}
	var decodedJSON string
	if err := json.Unmarshal(jsonOutput, &decodedJSON); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if decodedJSON != Redacted {
		t.Errorf("decoded JSON = %q, want %q", decodedJSON, Redacted)
	}
	yamlOutput, err := value.MarshalYAML()
	if err != nil {
		t.Fatalf("MarshalYAML() error = %v", err)
	}

	outputs := []struct {
		name string
		got  string
		want string
	}{
		{name: "String", got: value.String(), want: Redacted},
		{name: "%v", got: fmt.Sprintf("%v", value), want: Redacted},
		{name: "%+v", got: fmt.Sprintf("%+v", value), want: Redacted},
		{name: "%#v", got: fmt.Sprintf("%#v", value), want: Redacted},
		{name: "YAML", got: fmt.Sprint(yamlOutput), want: Redacted},
	}

	for _, output := range outputs {
		t.Run(output.name, func(t *testing.T) {
			if output.got != output.want {
				t.Errorf("serialized value = %q, want %q", output.got, output.want)
			}
			if strings.Contains(output.got, plaintext) {
				t.Errorf("serialized value contains plaintext credential")
			}
		})
	}
	if strings.Contains(string(jsonOutput), plaintext) {
		t.Errorf("JSON output contains plaintext credential")
	}
}

func TestStringRemainsRedactedInsideContainers(t *testing.T) {
	const plaintext = "nested-secret-value"
	value := struct {
		Credential String `json:"credential"`
	}{Credential: String(plaintext)}

	jsonOutput, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	var decodedJSON struct {
		Credential string `json:"credential"`
	}
	if err := json.Unmarshal(jsonOutput, &decodedJSON); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if decodedJSON.Credential != Redacted {
		t.Errorf("decoded JSON credential = %q, want %q", decodedJSON.Credential, Redacted)
	}

	outputs := map[string]string{
		"%v":  fmt.Sprintf("%v", value),
		"%+v": fmt.Sprintf("%+v", value),
		"%#v": fmt.Sprintf("%#v", value),
	}
	for name, output := range outputs {
		t.Run(name, func(t *testing.T) {
			if strings.Contains(output, plaintext) {
				t.Errorf("serialized container contains plaintext credential: %q", output)
			}
			if !strings.Contains(output, Redacted) {
				t.Errorf("serialized container = %q, want redaction marker", output)
			}
		})
	}
	if strings.Contains(string(jsonOutput), plaintext) {
		t.Errorf("serialized JSON container contains plaintext credential")
	}
}

func TestFormatIgnoresVerbsFlagsWidthAndPrecision(t *testing.T) {
	value := String("credential")
	formats := []string{"%s", "%q", "%x", "%d", "%+10v", "%#.3v"}
	for _, format := range formats {
		t.Run(format, func(t *testing.T) {
			if got := fmt.Sprintf(format, value); got != Redacted {
				t.Errorf("fmt.Sprintf(%q) = %q, want %q", format, got, Redacted)
			}
		})
	}
}

func TestMaskNeverReturnsInput(t *testing.T) {
	for _, plaintext := range []String{"", "short", "line one\nline two", `quote"value`} {
		if got := Mask(string(plaintext)); got != Redacted {
			t.Errorf("Mask() = %q, want %q", got, Redacted)
		}
	}
}
