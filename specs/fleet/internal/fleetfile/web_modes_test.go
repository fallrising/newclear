package fleetfile

import "testing"

func TestWebExposureModes(t *testing.T) {
	for _, mode := range []string{"public", "access", "private", "unknown"} {
		t.Run(mode, func(t *testing.T) {
			doc := loadYAML(t, "valid-public.yaml")
			doc.Spec.Expose.Mode = mode
			doc.Spec.Expose.Hostname = ""
			err := Validate(doc, TestConfig())
			if mode == "public" || mode == "access" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatalf("unsupported mode %q accepted", mode)
			}
		})
	}
}
