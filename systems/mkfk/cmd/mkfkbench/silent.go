package main

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"encoding/json/jsontext"
	jsonv2 "encoding/json/v2"

	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

// Locked to finding 4 and the owner's compose decision. These are the
// documented rf3-isr2-b1-p1 workload numbers, not knobs.
const (
	silentWarmup             = 10 * time.Second
	silentMeasure            = 60 * time.Second
	silentRepeats            = 3
	silentRecordBytes        = 1024
	silentProducers          = 4
	silentBatch              = 1
	silentPartitions         = 1
	eventsLeaderSeries       = `mkfk_leader{topic="events",partition="0"}`
	silentFollowerDefinition = "A non-leader of events partition 0 (leader gauge 0 at both scrapes of one 60s measurement window) reproduces the finding when mkfk_fsync_total delta is 0 and that broker's log has zero lines timestamped in the same window."
)

// Published by deploy/compose.yaml. The bridge addresses live only in the
// cluster file the containers mount; this process uses the loopback publishes.
var silentAdmins = map[uint32]string{
	1: "127.0.0.1:19291",
	2: "127.0.0.1:19292",
	3: "127.0.0.1:19293",
}

var silentClients = map[uint32]string{
	1: "http://127.0.0.1:19091",
	2: "http://127.0.0.1:19092",
	3: "http://127.0.0.1:19093",
}

var (
	ipv4Address = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
	absPath     = regexp.MustCompile(`(^|[\s"=])(/[A-Za-z0-9._~@+/-]+)`)
)

type silentReport struct {
	Commit      string         `json:"commit"`
	GoVersion   string         `json:"go"`
	Config      string         `json:"config"`
	Workload    silentWorkload `json:"workload"`
	Launcher    string         `json:"launcher"`
	Definition  string         `json:"definition"`
	Verdict     string         `json:"verdict"`
	Scope       string         `json:"scope"`
	Repeats     []silentRepeat `json:"repeats"`
	Limitations []string       `json:"limitations"`
}

type silentWorkload struct {
	RecordBytes           int    `json:"record_bytes"`
	ProducersPerPartition int    `json:"producers_per_partition"`
	BatchRecords          int    `json:"batch_records"`
	Partitions            int    `json:"partitions"`
	Acks                  string `json:"acks"`
	Warmup                string `json:"warmup"`
	Measure               string `json:"measure"`
	Repeats               int    `json:"repeats"`
}

type silentRepeat struct {
	Repeat        int            `json:"repeat"`
	WindowStart   string         `json:"window_start"`
	WindowEnd     string         `json:"window_end"`
	RecordsPerSec float64        `json:"produce_records_per_sec"`
	ProduceErrors map[string]int `json:"produce_errors"`
	Brokers       []silentBroker `json:"brokers"`
}

type silentBroker struct {
	Broker             string `json:"broker"`
	LeaderKnownAtStart bool   `json:"events_leader_known_at_start"`
	LeaderAtStart      bool   `json:"events_leader_at_start"`
	LeaderKnownAtEnd   bool   `json:"events_leader_known_at_end"`
	LeaderAtEnd        bool   `json:"events_leader_at_end"`
	FsyncKnown         bool   `json:"fsync_known"`
	FsyncDelta         int64  `json:"fsync_delta"`
	LogLinesInWindow   int    `json:"log_lines_in_window"`
	UnparsedLogLines   int    `json:"unparsed_log_lines"`
	Silent             bool   `json:"silent"`
}

func runSilentFollower(out, commit, project, dockerBin string) error {
	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	probe := &http.Client{Timeout: 5 * time.Second}
	if err := waitComposeServing(probe, 60*time.Second); err != nil {
		return err
	}
	transport, err := client.NewClusterTransport(&http.Client{Timeout: 15 * time.Second}, silentClients)
	if err != nil {
		return err
	}
	workload := workload{
		Partitions: silentPartitions, Batch: silentBatch, RecordBytes: silentRecordBytes,
		ProducersPerPartition: silentProducers, Warmup: silentWarmup, Duration: silentMeasure,
	}
	report := silentReport{
		Commit: commit, GoVersion: runtime.Version(), Config: "rf3-isr2-b1-p1",
		Workload: silentWorkload{
			RecordBytes: silentRecordBytes, ProducersPerPartition: silentProducers,
			BatchRecords: silentBatch, Partitions: silentPartitions, Acks: "all",
			Warmup: "10s", Measure: "60s", Repeats: silentRepeats,
		},
		Launcher:   "existing three-broker compose; no netem; no injected disk latency",
		Definition: silentFollowerDefinition,
		Scope:      "this compose run only",
		Limitations: []string{
			"有 means the finding's measurement occurred on this compose run",
			"沒有 means it was not seen here; it does not mean environment B is fine",
			"Docker does not reproduce another machine's clock skew or network",
			"leader and fsync are the two scrapes at the window boundaries, the same pair the bench records",
		},
	}
	type pending struct {
		repeat      silentRepeat
		windowStart time.Time
		windowEnd   time.Time
		before      []sample
		after       []sample
	}
	var ran []pending
	for repeat := 1; repeat <= silentRepeats; repeat++ {
		windowStart := time.Now().Add(silentWarmup)
		windowEnd := windowStart.Add(silentMeasure)
		var before, after []sample
		scraped := make(chan error, 1)
		go func() {
			time.Sleep(time.Until(windowStart))
			var err error
			before, err = scrapeCompose(probe)
			time.Sleep(time.Until(windowEnd))
			if err == nil {
				after, err = scrapeCompose(probe)
			}
			scraped <- err
		}()
		recorded, err := produce(transport, workload, repeat, windowStart, windowEnd)
		if err != nil {
			return fmt.Errorf("repeat %d: %w", repeat, err)
		}
		if err := <-scraped; err != nil {
			return fmt.Errorf("repeat %d: %w", repeat, err)
		}
		logf("rf3-isr2-b1-p1 repeat %d: %.0f records/s", repeat, float64(recorded.records)/silentMeasure.Seconds())
		ran = append(ran, pending{
			repeat: silentRepeat{
				Repeat: repeat, WindowStart: windowStart.UTC().Format(time.RFC3339Nano),
				WindowEnd:     windowEnd.UTC().Format(time.RFC3339Nano),
				RecordsPerSec: float64(recorded.records) / silentMeasure.Seconds(),
				ProduceErrors: recorded.errors,
			},
			windowStart: windowStart, windowEnd: windowEnd, before: before, after: after,
		})
	}
	logs := map[uint32]string{}
	for id := uint32(1); id <= 3; id++ {
		text, err := brokerLogs(dockerBin, project, id)
		if err != nil {
			return err
		}
		logs[id] = text
		scrubbed := scrubIdentifiers(text)
		name := fmt.Sprintf("broker-%d.log", id)
		if err := os.WriteFile(filepath.Join(out, name), []byte(scrubbed), 0o644); err != nil {
			return err
		}
	}
	var judged []silentBroker
	for _, item := range ran {
		repeat := item.repeat
		for id := uint32(1); id <= 3; id++ {
			lines, unparsed := countWindowLines(logs[id], item.windowStart, item.windowEnd)
			broker := judgeBroker(fmt.Sprintf("broker-%d", id), item.before[id-1], item.after[id-1], lines, unparsed)
			repeat.Brokers = append(repeat.Brokers, broker)
			judged = append(judged, broker)
		}
		report.Repeats = append(report.Repeats, repeat)
	}
	report.Verdict = verdictOf(judged)
	if err := writeSilent(out, report); err != nil {
		return err
	}
	fmt.Printf("靜默 60 秒：%s\n", report.Verdict)
	if report.Verdict == "有" {
		fmt.Println("A non-leader broker had mkfk_fsync_total delta 0 and zero log lines in one 60s window.")
	} else {
		fmt.Println("This compose run did not show that measurement. It does not mean environment B is fine.")
	}
	return nil
}

func verdictOf(brokers []silentBroker) string {
	for _, broker := range brokers {
		if broker.Silent {
			return "有"
		}
	}
	return "沒有"
}

func waitComposeServing(probe *http.Client, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if composeServing(probe) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("compose cluster not serving after %s", timeout)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func composeServing(probe *http.Client) bool {
	leaders := map[string]bool{}
	for id := uint32(1); id <= 3; id++ {
		values, err := scrape(probe, silentAdmins[id])
		if err != nil || values["mkfk_ready"] != 1 {
			return false
		}
		for series, value := range values {
			if strings.HasPrefix(series, "mkfk_leader_ready{") && value == 1 {
				leaders[series] = true
			}
		}
	}
	return len(leaders) == silentPartitions+1
}

func scrapeCompose(probe *http.Client) ([]sample, error) {
	var samples []sample
	for id := uint32(1); id <= 3; id++ {
		values, err := scrape(probe, silentAdmins[id])
		if err != nil {
			return nil, err
		}
		samples = append(samples, values)
	}
	return samples, nil
}

func judgeBroker(name string, before, after sample, logLines, unparsed int) silentBroker {
	leaderStart, knownStart := eventsLeader(before)
	leaderEnd, knownEnd := eventsLeader(after)
	delta, knownFsync := fsyncDelta(before, after)
	broker := silentBroker{
		Broker: name, LeaderKnownAtStart: knownStart, LeaderAtStart: leaderStart,
		LeaderKnownAtEnd: knownEnd, LeaderAtEnd: leaderEnd,
		FsyncKnown: knownFsync, FsyncDelta: delta,
		LogLinesInWindow: logLines, UnparsedLogLines: unparsed,
	}
	broker.Silent = brokerIsSilent(broker)
	return broker
}

func eventsLeader(values sample) (leader, known bool) {
	value, ok := values[eventsLeaderSeries]
	if !ok {
		return false, false
	}
	return value == 1, true
}

func fsyncDelta(before, after sample) (int64, bool) {
	start, startOK := before["mkfk_fsync_total"]
	end, endOK := after["mkfk_fsync_total"]
	if !startOK || !endOK {
		return 0, false
	}
	return int64(end - start), true
}

func brokerIsSilent(broker silentBroker) bool {
	return broker.LeaderKnownAtStart && !broker.LeaderAtStart &&
		broker.LeaderKnownAtEnd && !broker.LeaderAtEnd &&
		broker.FsyncKnown && broker.FsyncDelta == 0 &&
		broker.LogLinesInWindow == 0 && broker.UnparsedLogLines == 0
}

func countWindowLines(logs string, start, end time.Time) (inWindow, unparsed int) {
	for line := range strings.Lines(logs) {
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			continue
		}
		stamp, ok := logTimestamp(line)
		if !ok {
			unparsed++
			continue
		}
		if !stamp.Before(start) && stamp.Before(end) {
			inWindow++
		}
	}
	return inWindow, unparsed
}

func logTimestamp(line string) (time.Time, bool) {
	if _, after, ok := strings.Cut(line, " | "); ok {
		line = after
	}
	stamp, _, _ := strings.Cut(line, " ")
	parsed, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func scrubIdentifiers(text string) string {
	text = ipv4Address.ReplaceAllString(text, "[ip]")
	return absPath.ReplaceAllString(text, "${1}[path]")
}

func brokerLogs(dockerBin, project string, id uint32) (string, error) {
	service := fmt.Sprintf("broker-%d", id)
	output, err := commandOutput(dockerBin, "compose", "-p", project,
		"-f", "deploy/compose.yaml", "-f", "deploy/compose.silent-follower.yaml",
		"logs", "--no-color", "--timestamps", "--no-log-prefix", service)
	if err != nil {
		return "", fmt.Errorf("logs for %s: %w", service, err)
	}
	return string(output), nil
}

func commandOutput(dockerBin string, args ...string) ([]byte, error) {
	parts := strings.Fields(dockerBin)
	if len(parts) == 0 {
		return nil, fmt.Errorf("docker CLI is empty")
	}
	command := exec.Command(parts[0], append(parts[1:], args...)...)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return nil, fmt.Errorf("%v: %s", err, stderr.String())
	}
	return stdout.Bytes(), nil
}

func writeSilent(out string, report silentReport) error {
	data, err := jsonv2.Marshal(&report, jsontext.WithIndent("  "))
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(filepath.Join(out, "results.json"), data, 0o644)
}
