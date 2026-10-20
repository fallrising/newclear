// Package rules loads Prometheus rule files and reloads them on demand.
//
// Parsing goes through github.com/prometheus/prometheus/model/rulefmt (module
// v0.53.0). Production code does not execute promtool. AC-87 compares this
// loader with pinned promtool 2.53.0 in an opt-in integration test, because
// default CI is `make lint test` and workflow changes are outside P2-06:
//
//	PROMTOOL_BINARY=/path/to/prometheus-2.53.0.linux-amd64/promtool \
//	  go test -tags=integration -count=1 -run TestAC87Promtool ./internal/alerting/rules
//
// The official linux/amd64 tarball SHA256 is
// d9900a11e3c89261e6416e3c9989858bad7b206af8b6838dfe9a5392d8ddc60d.
// promtool version 2.53.0, revision 4c35b9250afefede41c5f5acd76191f90f625898.
package rules
