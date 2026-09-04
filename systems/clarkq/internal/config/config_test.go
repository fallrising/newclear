package config

import (
	"testing"
)

func TestParseEncryptionQueues(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want map[string]string
	}{
		{
			name: "empty",
			raw:  "",
			want: nil,
		},
		{
			name: "single",
			raw:  "secure:server_rsa",
			want: map[string]string{"secure": "server_rsa"},
		},
		{
			name: "multiple with spaces",
			raw:  " secure:server_rsa , e2e:client , plain:none ",
			want: map[string]string{
				"secure": "server_rsa",
				"e2e":    "client",
				"plain":  "none",
			},
		},
		{
			name: "duplicate last wins",
			raw:  "q:client,q:server_rsa",
			want: map[string]string{"q": "server_rsa"},
		},
		{
			name: "skips invalid entries",
			raw:  "badentry,also-bad:,:client,good:client",
			want: map[string]string{"good": "client"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseEncryptionQueues(tt.raw)
			if len(got) != len(tt.want) {
				t.Fatalf("len = %d, want %d (%v vs %v)", len(got), len(tt.want), got, tt.want)
			}
			for k, v := range tt.want {
				if got[k] != v {
					t.Fatalf("got[%q]=%q, want %q", k, got[k], v)
				}
			}
		})
	}
}

func TestConfigValidate(t *testing.T) {
	cfg := Config{
		EncryptionMode: "none",
		EncryptionQueues: map[string]string{
			"secure": "server_rsa",
			"e2e":    "client",
		},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}

	cfg.EncryptionMode = "bogus"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid default mode error")
	}

	cfg.EncryptionMode = "none"
	cfg.EncryptionQueues = map[string]string{"bad name!": "client"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid queue name error")
	}

	cfg.EncryptionQueues = map[string]string{"ok": "not-a-mode"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid mode error")
	}
}
