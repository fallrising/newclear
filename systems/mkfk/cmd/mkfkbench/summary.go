package main

import (
	"fmt"
	"sort"
	"strings"
)

// summary renders the median of each configuration's repeats.
func summary(result report) string {
	var out strings.Builder
	fmt.Fprintf(&out, "# mkfk benchmark baseline\n\nCommit `%s`, %s, %s. Warm-up %s, measured %s, %d repeats; medians shown.\n\n",
		result.Commit, result.GoVersion, result.Launcher, result.Warmup, result.Duration, result.Repeats)
	for _, node := range []string{"node-1", "node-2", "node-3"} {
		fmt.Fprintf(&out, "- %s: %s\n", node, result.Machines[node])
	}
	out.WriteString("\n| Config | records/s | MiB/s | produce p50/p95/p99 ms | fetch records/s | fetch p99 ms | leader CPU % | max RSS MiB | fsync mean ms | seek comparisons/fetch | restart s |\n")
	out.WriteString("| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n")
	for _, config := range result.Results {
		if config.Error != "" {
			fmt.Fprintf(&out, "| %s | failed: %s | | | | | | | | | |\n", config.Config.name(), config.Error)
			continue
		}
		median := func(value func(runResult) float64) float64 {
			values := make([]float64, 0, len(config.Runs))
			for _, run := range config.Runs {
				values = append(values, value(run))
			}
			sort.Float64s(values)
			if len(values) == 0 {
				return 0
			}
			return values[len(values)/2]
		}
		maxBroker := func(run runResult, value func(brokerUsage) float64) float64 {
			best := 0.0
			for _, broker := range run.Brokers {
				best = max(best, value(broker))
			}
			return best
		}
		fmt.Fprintf(&out, "| %s | %.0f | %.2f | %.1f / %.1f / %.1f | %.0f | %.1f | %.0f | %.0f | %.2f | %.1f | %.2f |\n",
			config.Config.name(),
			median(func(r runResult) float64 { return r.Measurement.RecordsPerSec }),
			median(func(r runResult) float64 { return r.Measurement.BytesPerSec / (1 << 20) }),
			median(func(r runResult) float64 { return r.Measurement.Produce.P50 }),
			median(func(r runResult) float64 { return r.Measurement.Produce.P95 }),
			median(func(r runResult) float64 { return r.Measurement.Produce.P99 }),
			median(func(r runResult) float64 { return r.Measurement.FetchPerSec }),
			median(func(r runResult) float64 { return r.Measurement.Fetch.P99 }),
			median(func(r runResult) float64 { return maxBroker(r, func(b brokerUsage) float64 { return b.CPUPercent }) }),
			median(func(r runResult) float64 {
				return maxBroker(r, func(b brokerUsage) float64 { return float64(b.RSSBytes) / (1 << 20) })
			}),
			median(func(r runResult) float64 { return maxBroker(r, func(b brokerUsage) float64 { return b.FsyncMeanMS }) }),
			median(func(r runResult) float64 { return r.ReadBack.ComparisonsPerOp }),
			config.RecoverySeconds)
	}
	out.WriteString("\nLimitations:\n")
	for _, limitation := range result.Limitations {
		fmt.Fprintf(&out, "- %s\n", limitation)
	}
	return out.String()
}
