// Command mkfkbench measures the 04-validation §5 workload matrix: RF1 and
// RF3 (min_isr 1 and 2), 1 KiB records, batches of 1 and 100, one and
// three partitions, repeated runs with warm-up, a read-back, and a cold
// restart. It writes raw results and a summary; it promises no numbers.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func logf(format string, arguments ...any) {
	fmt.Fprintf(os.Stderr, time.Now().Format("15:04:05 ")+format+"\n", arguments...)
}

type report struct {
	Started     string            `json:"started"`
	Commit      string            `json:"commit"`
	GoVersion   string            `json:"go"`
	Launcher    string            `json:"launcher"`
	Machines    map[string]string `json:"machines"`
	Warmup      string            `json:"warmup"`
	Duration    string            `json:"measure"`
	Repeats     int               `json:"repeats"`
	Results     []configResult    `json:"results"`
	Limitations []string          `json:"limitations"`
}

func main() {
	binary := flag.String("mkfk", "", "path to the mkfk broker binary (required)")
	out := flag.String("out", ".test-output/bench", "directory for results.json and summary.md")
	commit := flag.String("commit", "unknown", "source commit being measured")
	warmup := flag.Duration("warmup", 10*time.Second, "warm-up before each measured run")
	duration := flag.Duration("duration", 60*time.Second, "measured run length")
	repeats := flag.Int("repeat", 3, "measured runs per configuration")
	recordBytes := flag.Int("record-bytes", 1024, "record value size")
	producers := flag.Int("producers", 4, "closed-loop producers per partition")
	only := flag.String("only", "", "comma-separated configuration names to run (default all)")
	hosts := flag.String("ssh-hosts", "", "three ssh hosts; brokers then run remotely, one per host")
	ips := flag.String("ssh-ips", "", "the hosts' private-network IPs for broker listeners")
	remoteDir := flag.String("ssh-dir", "mkfk-bench", "remote working directory")
	sshCommand := flag.String("ssh-command", "ssh -o BatchMode=yes", "ssh command and options used to reach the hosts")
	flag.Parse()
	if *binary == "" {
		fmt.Fprintln(os.Stderr, "--mkfk is required")
		os.Exit(2)
	}
	if err := run(*binary, *out, *commit, *warmup, *duration, *repeats, *recordBytes, *producers, *only, *hosts, *ips, *sshCommand, *remoteDir); err != nil {
		fmt.Fprintln(os.Stderr, "bench failed:", err)
		os.Exit(1)
	}
}

func run(binary, out, commit string, warmup, duration time.Duration, repeats, recordBytes, producers int, only, hosts, ips, sshCommand, remoteDir string) error {
	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	var l launcher
	var err error
	name := "local loopback child processes"
	if hosts != "" {
		l, err = newSSHLauncher(strings.Split(hosts, ","), strings.Split(ips, ","), strings.Fields(sshCommand), remoteDir, binary)
		name = "three hosts on a private network, one broker each; the client runs on the node-3 host"
	} else {
		l, err = newLocalLauncher(binary, filepath.Join(out, "cluster"))
	}
	if err != nil {
		return err
	}
	result := report{
		Started: time.Now().UTC().Format(time.RFC3339), Commit: commit, GoVersion: runtime.Version(), Launcher: name,
		Machines: map[string]string{}, Warmup: warmup.String(), Duration: duration.String(), Repeats: repeats,
		Limitations: []string{
			"one closed-loop request per producer: throughput is latency-bound, not a saturation ceiling",
			"every acknowledged batch waits for acks=all and per-append fsync; no group commit or pipelined client",
			"fsync max is the process lifetime maximum, not per window",
		},
	}
	for id := uint32(1); id <= 3; id++ {
		result.Machines[fmt.Sprintf("node-%d", id)] = l.machine(id)
	}
	selected := map[string]bool{}
	for _, name := range strings.Split(only, ",") {
		if name != "" {
			selected[name] = true
		}
	}
	w := workload{RecordBytes: recordBytes, ProducersPerPartition: producers, Warmup: warmup, Duration: duration}
	for index, c := range matrixConfigs() {
		if len(selected) > 0 && !selected[c.name()] {
			continue
		}
		w.Batch, w.Partitions = c.Batch, c.Partitions
		logf("%s: starting", c.name())
		configResult, err := runConfig(l, c, w, repeats, index*100)
		if err != nil {
			configResult.Error = err.Error()
			logf("%s: failed: %v", c.name(), err)
		} else {
			logf("%s: cold restart served again in %.2fs", c.name(), configResult.RecoverySeconds)
		}
		result.Results = append(result.Results, configResult)
		if err := write(out, result); err != nil {
			return err
		}
	}
	return nil
}

func write(out string, result report) error {
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(out, "results.json"), data, 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, "summary.md"), []byte(summary(result)), 0o644)
}
