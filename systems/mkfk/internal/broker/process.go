package broker

import (
	"os"
	"strconv"
	"strings"
)

// processUsage reads this process's CPU time and resident memory from
// /proc on Linux; ok is false where /proc is unavailable.
func processUsage() (cpuSeconds float64, residentBytes int64, ok bool) {
	stat, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0, 0, false
	}
	// Fields after the parenthesized command: utime and stime are the 12th
	// and 13th (fields 14 and 15 of the whole line), in clock ticks.
	text := string(stat)
	fields := strings.Fields(text[strings.LastIndexByte(text, ')')+1:])
	if len(fields) < 13 {
		return 0, 0, false
	}
	utime, errUser := strconv.ParseFloat(fields[11], 64)
	stime, errSystem := strconv.ParseFloat(fields[12], 64)
	if errUser != nil || errSystem != nil {
		return 0, 0, false
	}
	status, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0, 0, false
	}
	for _, line := range strings.Split(string(status), "\n") {
		if value, found := strings.CutPrefix(line, "VmRSS:"); found {
			kib, err := strconv.ParseInt(strings.TrimSuffix(strings.TrimSpace(value), " kB"), 10, 64)
			if err == nil {
				residentBytes = kib << 10
			}
		}
	}
	const clockTicks = 100 // USER_HZ on Linux
	return (utime + stime) / clockTicks, residentBytes, true
}
