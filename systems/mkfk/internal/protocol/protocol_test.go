package protocol

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDecimalValuesAreCanonicalJSONStrings(t *testing.T) {
	t.Parallel()
	for _, valid := range []string{`"0"`, `"42"`, `"18446744073709551615"`} {
		var value DecimalUint64
		if err := DecodeJSON([]byte(valid), &value); err != nil {
			t.Errorf("DecodeJSON(%s): %v", valid, err)
		}
	}
	for _, invalid := range []string{`0`, `"00"`, `"-1"`, `"+1"`, `"18446744073709551616"`} {
		var value DecimalUint64
		if err := DecodeJSON([]byte(invalid), &value); err == nil {
			t.Errorf("DecodeJSON(%s) unexpectedly succeeded", invalid)
		}
	}
}

func TestProduceContract(t *testing.T) {
	t.Parallel()
	body := []byte(`{
        "topic":"events",
        "partition":0,
        "producer_id":"90f67d4e-13c5-4a3c-8d62-443f1bbb1af4",
        "epoch":"0",
        "first_sequence":"0",
        "acks":"all",
        "records":[{"key_base64":"dXNlcjox","value_base64":"aGVsbG8="}]
    }`)
	var request ProduceRequest
	if err := DecodeJSON(body, &request); err != nil {
		t.Fatal(err)
	}
	validated, err := request.Validate()
	if err != nil {
		t.Fatal(err)
	}
	if validated.NextSequence != 1 || string(validated.Records[0].Key) != "user:1" || string(validated.Records[0].Value) != "hello" {
		t.Fatalf("unexpected validated request: %#v", validated)
	}
}

func TestProduceRejectsMalformedBoundaries(t *testing.T) {
	t.Parallel()
	valid := `{
        "topic":"events","partition":0,
        "producer_id":"90f67d4e-13c5-4a3c-8d62-443f1bbb1af4",
        "epoch":"0","first_sequence":"0","acks":"all",
        "records":[{"key_base64":null,"value_base64":""}]
    }`
	for name, body := range map[string]string{
		"duplicate":         replaceOnce(valid, `"topic":"events"`, `"topic":"events","topic":"events"`),
		"unknown":           replaceOnce(valid, `"partition":0`, `"partition":0,"surprise":true`),
		"numeric epoch":     replaceOnce(valid, `"epoch":"0"`, `"epoch":0`),
		"bad base64":        replaceOnce(valid, `"value_base64":""`, `"value_base64":"%%%="`),
		"missing key":       replaceOnce(valid, `"key_base64":null,`, ``),
		"missing epoch":     replaceOnce(valid, `"epoch":"0",`, ``),
		"missing partition": replaceOnce(valid, `"partition":0,`, ``),
		"unsupported ack":   replaceOnce(valid, `"acks":"all"`, `"acks":"1"`),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var request ProduceRequest
			err := DecodeJSON([]byte(body), &request)
			if err == nil {
				_, err = request.Validate()
			}
			if err == nil {
				t.Fatalf("invalid request was accepted: %s", body)
			}
		})
	}
}

func TestFingerprintGoldenVectors(t *testing.T) {
	t.Parallel()
	type vector struct {
		Name        string  `json:"name"`
		KeyBase64   *string `json:"key_base64"`
		ValueBase64 string  `json:"value_base64"`
		SHA256      string  `json:"sha256"`
	}
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "fingerprint-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vectors []vector
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors {
		vector := vector
		t.Run(vector.Name, func(t *testing.T) {
			t.Parallel()
			var key []byte
			if vector.KeyBase64 != nil {
				key, err = base64.StdEncoding.DecodeString(*vector.KeyBase64)
				if err != nil {
					t.Fatal(err)
				}
			}
			value, err := base64.StdEncoding.DecodeString(vector.ValueBase64)
			if err != nil {
				t.Fatal(err)
			}
			digest, err := BatchFingerprint([]Record{{Key: key, Value: value}})
			if err != nil {
				t.Fatal(err)
			}
			if got := hex.EncodeToString(digest[:]); got != vector.SHA256 {
				t.Fatalf("digest = %s, want %s", got, vector.SHA256)
			}
		})
	}
}

func TestPartitionGoldenVectors(t *testing.T) {
	t.Parallel()
	type vector struct {
		KeyBase64      string `json:"key_base64"`
		PartitionCount uint32 `json:"partition_count"`
		Partition      uint32 `json:"partition"`
	}
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "partition-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vectors []vector
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors {
		key, err := base64.StdEncoding.DecodeString(vector.KeyBase64)
		if err != nil {
			t.Fatal(err)
		}
		partition, err := PartitionForKey(key, vector.PartitionCount)
		if err != nil {
			t.Fatal(err)
		}
		if partition != vector.Partition {
			t.Fatalf("partition = %d, want %d", partition, vector.Partition)
		}
	}
}

func replaceOnce(input, old, replacement string) string {
	for i := 0; i+len(old) <= len(input); i++ {
		if input[i:i+len(old)] == old {
			return input[:i] + replacement + input[i+len(old):]
		}
	}
	return input
}
