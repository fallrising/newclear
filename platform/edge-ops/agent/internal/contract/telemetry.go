package contract

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
)

// TS twin: backend/src/domain/contract/telemetry.ts. Units live in field names, there are no
// floats, uint64 values are decimal strings, and nil means unsupported — never 0.
const (
	TelemetryMaxBytes = 256 * 1024
	MaxSeriesEntries  = 32
)

var (
	reportFields = []string{
		"schema_version", "node_id", "enrollment_generation", "boot_id", "seq", "window_start",
		"window_end", "sample_count", "agent_version", "spool_dropped_reports", "metrics",
	}
	metricFields = []string{
		"cpu_busy_bp", "load1_milli", "load5_milli", "load15_milli", "mem_total_bytes",
		"mem_available_bytes", "swap_total_bytes", "swap_free_bytes", "uptime_seconds", "mounts",
		"disk_io", "net",
	}
	bootID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	u64Re  = regexp.MustCompile(`^(0|[1-9][0-9]{0,19})$`)
	label  = regexp.MustCompile(`^[A-Za-z0-9_./:@-]{1,128}$`)
)

// Window is a one-minute aggregate in basis points (0..10000).
type Window struct{ Avg, Max, Last int64 }

// Series is one labelled entry of mounts, disk_io or net, keyed by its field names.
type Series map[string]string

// Metrics holds the baseline collector metrics; nil pointers or slices mean unsupported.
type Metrics struct {
	CPUBusyBP                                      *Window
	Load1Milli, Load5Milli, Load15Milli            *int64
	MemTotalBytes, MemAvailableBytes               *string
	SwapTotalBytes, SwapFreeBytes                  *string
	UptimeSeconds                                  *int64
	Mounts, DiskIO, Net                            []Series
	MountsSupported, DiskIOSupported, NetSupported bool
}

type TelemetryReport struct {
	NodeID               string
	EnrollmentGeneration int64
	BootID               string
	Seq                  int64
	WindowStart          int64
	WindowEnd            int64
	SampleCount          int64
	AgentVersion         string
	SpoolDroppedReports  int64
	Metrics              Metrics
}

func ParseTelemetryReport(b []byte) (*TelemetryReport, error) {
	v, err := ParseStrictJSON(b, TelemetryMaxBytes)
	if err != nil {
		return nil, err
	}
	doc, err := checkShape(v, "edgeops.telemetry", 1, reportFields)
	if err != nil {
		return nil, err
	}
	r := &TelemetryReport{}
	steps := []func() error{
		func() (e error) { r.NodeID, e = str(doc, "node_id", nodeID); return },
		func() (e error) {
			r.EnrollmentGeneration, e = intField(doc, "enrollment_generation", 1, 2147483647)
			return
		},
		func() (e error) { r.BootID, e = str(doc, "boot_id", bootID); return },
		func() (e error) { r.Seq, e = intField(doc, "seq", 0, maxSafeInteger); return },
		func() (e error) { r.WindowStart, e = timeField(doc, "window_start"); return },
		func() (e error) { r.WindowEnd, e = timeField(doc, "window_end"); return },
		func() (e error) { r.SampleCount, e = intField(doc, "sample_count", 0, 3600); return },
		func() (e error) { r.AgentVersion, e = str(doc, "agent_version", agentVer); return },
		func() (e error) {
			r.SpoolDroppedReports, e = intField(doc, "spool_dropped_reports", 0, maxSafeInteger)
			return
		},
		func() (e error) { return parseMetrics(doc["metrics"], &r.Metrics) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return nil, err
		}
	}
	if r.WindowEnd < r.WindowStart || r.WindowEnd-r.WindowStart > 3600 {
		return nil, errf("invalid_field", "window_end", "window must be 0..3600 seconds")
	}
	return r, nil
}

func parseMetrics(v any, m *Metrics) error {
	obj, ok := v.(map[string]any)
	if !ok {
		return errf("invalid_field", "metrics", "must be an object")
	}
	if err := checkKeys(obj, "metrics", metricFields); err != nil {
		return err
	}
	var err error
	intPtr := func(k string, max int64) (*int64, error) {
		if obj[k] == nil {
			return nil, nil
		}
		n, e := intValue(obj[k], "metrics."+k, 0, max)
		return &n, e
	}
	strPtr := func(k string) (*string, error) {
		if obj[k] == nil {
			return nil, nil
		}
		s, e := u64(obj[k], "metrics."+k)
		return &s, e
	}
	steps := []func() error{
		func() error {
			if obj["cpu_busy_bp"] == nil {
				return nil
			}
			m.CPUBusyBP, err = window(obj["cpu_busy_bp"], "metrics.cpu_busy_bp")
			return err
		},
		func() error { m.Load1Milli, err = intPtr("load1_milli", 100_000_000); return err },
		func() error { m.Load5Milli, err = intPtr("load5_milli", 100_000_000); return err },
		func() error { m.Load15Milli, err = intPtr("load15_milli", 100_000_000); return err },
		func() error { m.MemTotalBytes, err = strPtr("mem_total_bytes"); return err },
		func() error { m.MemAvailableBytes, err = strPtr("mem_available_bytes"); return err },
		func() error { m.SwapTotalBytes, err = strPtr("swap_total_bytes"); return err },
		func() error { m.SwapFreeBytes, err = strPtr("swap_free_bytes"); return err },
		func() error { m.UptimeSeconds, err = intPtr("uptime_seconds", maxSafeInteger); return err },
		func() error {
			m.Mounts, m.MountsSupported, err = series(obj["mounts"], "metrics.mounts", "mount", "total_bytes", "avail_bytes")
			return err
		},
		func() error {
			m.DiskIO, m.DiskIOSupported, err = series(obj["disk_io"], "metrics.disk_io", "device", "read_bytes_total", "write_bytes_total")
			return err
		},
		func() error {
			m.Net, m.NetSupported, err = series(obj["net"], "metrics.net", "iface", "rx_bytes_total", "tx_bytes_total")
			return err
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	return nil
}

func checkKeys(obj map[string]any, field string, allowed []string) error {
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !slices.Contains(allowed, k) {
			return errf("unknown_field", field+"."+k, "unknown field")
		}
	}
	for _, k := range allowed {
		if _, ok := obj[k]; !ok {
			return errf("missing_field", field+"."+k, "required; use null when unsupported")
		}
	}
	return nil
}

func intValue(v any, field string, min, max int64) (int64, error) {
	n, ok := v.(int64)
	if !ok || n < min || n > max {
		return 0, errf("invalid_field", field, "must be an integer in [%d, %d]", min, max)
	}
	return n, nil
}

func u64(v any, field string) (string, error) {
	s, ok := v.(string)
	if !ok || !u64Re.MatchString(s) {
		return "", errf("invalid_field", field, "must be a uint64 decimal string")
	}
	if _, err := strconv.ParseUint(s, 10, 64); err != nil {
		return "", errf("invalid_field", field, "must be a uint64 decimal string")
	}
	return s, nil
}

func window(v any, field string) (*Window, error) {
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, errf("invalid_field", field, "must be an object")
	}
	if err := checkKeys(obj, field, []string{"avg", "max", "last"}); err != nil {
		return nil, err
	}
	w := &Window{}
	var err error
	if w.Avg, err = intValue(obj["avg"], field+".avg", 0, 10000); err != nil {
		return nil, err
	}
	if w.Max, err = intValue(obj["max"], field+".max", 0, 10000); err != nil {
		return nil, err
	}
	if w.Last, err = intValue(obj["last"], field+".last", 0, 10000); err != nil {
		return nil, err
	}
	if w.Avg > w.Max || w.Last > w.Max {
		return nil, errf("invalid_field", field+".max", "max must bound avg and last")
	}
	return w, nil
}

// series parses a labelled array; the first key is the label, the rest are uint64 strings.
func series(v any, field string, keys ...string) ([]Series, bool, error) {
	if v == nil {
		return nil, false, nil
	}
	arr, ok := v.([]any)
	if !ok || len(arr) > MaxSeriesEntries {
		return nil, false, errf("invalid_field", field, "must be an array of at most %d", MaxSeriesEntries)
	}
	out := make([]Series, 0, len(arr))
	seen := map[string]bool{}
	for i, e := range arr {
		ef := fmt.Sprintf("%s[%d]", field, i)
		obj, ok := e.(map[string]any)
		if !ok {
			return nil, false, errf("invalid_field", ef, "must be an object")
		}
		if err := checkKeys(obj, ef, keys); err != nil {
			return nil, false, err
		}
		lbl, ok := obj[keys[0]].(string)
		if !ok || !label.MatchString(lbl) {
			return nil, false, errf("invalid_field", ef+"."+keys[0], "invalid label")
		}
		s := Series{keys[0]: lbl}
		for _, k := range keys[1:] {
			val, err := u64(obj[k], ef+"."+k)
			if err != nil {
				return nil, false, err
			}
			s[k] = val
		}
		if seen[lbl] {
			return nil, false, errf("invalid_field", ef, "duplicate series label")
		}
		seen[lbl] = true
		out = append(out, s)
	}
	return out, true, nil
}
