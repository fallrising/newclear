//go:build integration

package rules

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestAC87Promtool compares loader accept/reject with pinned promtool 2.53.0
// check rules. AC-89 is not compared: Prism rejects a second YAML document and
// promtool exits 0. AC-91 is included; both sides accept, and the unit test
// checks that Prism stores 30s.
//
// This file is not part of make lint test or Prism CI. Workflows are outside
// the P2-06 paths. Run:
//
//	PROMTOOL_BINARY=/path/to/prometheus-2.53.0.linux-amd64/promtool \
//	  go test -tags=integration -count=1 -run TestAC87Promtool ./internal/alerting/rules
//
// Tarball SHA256 d9900a11e3c89261e6416e3c9989858bad7b206af8b6838dfe9a5392d8ddc60d.
// The binary must print version 2.53.0 and revision 4c35b9250afefede41c5f5acd76191f90f625898.
func TestAC87Promtool(t *testing.T) {
	binary := os.Getenv("PROMTOOL_BINARY")
	if binary == "" {
		t.Fatal("set PROMTOOL_BINARY to pinned promtool 2.53.0; see the comment on TestAC87Promtool")
	}
	versionCmd := exec.CommandContext(t.Context(), binary, "--version") //nolint:gosec // Explicit pinned promtool path; no shell.
	versionOut, err := versionCmd.CombinedOutput()
	if err != nil {
		t.Fatalf("promtool --version: %v\n%s", err, versionOut)
	}
	version := string(versionOut)
	if !strings.Contains(version, "2.53.0") || !strings.Contains(version, "4c35b9250afefede41c5f5acd76191f90f625898") {
		t.Fatalf("promtool version = %s", version)
	}
	compared := 0
	for _, fx := range acRuleFixtures() {
		if !fx.ComparePromtool {
			continue
		}
		compared++
		t.Run(fx.AC+"/"+fx.Name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "rule.yaml")
			writeRule(t, dir, "rule.yaml", fx.Body)
			_, loadErr := Load(t.Context(), dir)
			command := exec.CommandContext(t.Context(), binary, "check", "rules", path) //nolint:gosec // Explicit pinned promtool path; no shell.
			output, runErr := command.CombinedOutput()
			promtoolAccept := runErr == nil
			if runErr != nil {
				exitErr, ok := errors.AsType[*exec.ExitError](runErr)
				if !ok {
					t.Fatalf("promtool: %v\n%s", runErr, output)
				}
				promtoolAccept = exitErr.ExitCode() == 0
			}
			if (loadErr == nil) != promtoolAccept {
				t.Fatalf("loader accept=%v err=%v promtool accept=%v output=%s", loadErr == nil, loadErr, promtoolAccept, output)
			}
		})
	}
	if compared == 0 {
		t.Fatal("no fixtures were compared")
	}
}
