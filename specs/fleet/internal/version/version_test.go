package version

import "testing"

func TestVersionSet(t *testing.T) {
	if Version == "" {
		t.Fatal("Version empty")
	}
}
