package jsonstrict

import "testing"

type fixture struct {
	Name string `json:"name"`
}

func TestDecodeStrictness(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name string
		json string
		ok   bool
	}{
		{name: "valid", json: `{"name":"mkfk"}`, ok: true},
		{name: "duplicate", json: `{"name":"a","name":"b"}`},
		{name: "unknown", json: `{"name":"a","extra":true}`},
		{name: "trailing", json: `{"name":"a"} {}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var got fixture
			err := Decode([]byte(test.json), &got)
			if (err == nil) != test.ok {
				t.Fatalf("Decode() error = %v, want success %v", err, test.ok)
			}
		})
	}
}
