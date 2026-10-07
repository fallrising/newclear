package main

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

type brokerUsage struct {
	Broker       string  `json:"broker"`
	CPUPercent   float64 `json:"cpu_percent_of_one_core"`
	RSSBytes     int64   `json:"rss_bytes"`
	Fsyncs       int64   `json:"fsyncs"`
	FsyncMeanMS  float64 `json:"fsync_mean_ms"`
	FsyncMaxMS   float64 `json:"fsync_max_ms_process_lifetime"`
	WALBytes     int64   `json:"wal_bytes_events"`
	IndexAnchors int64   `json:"index_anchors_events"`
}

type seekStats struct {
	Fetches           int64   `json:"fetches"`
	ComparisonsPerOp  float64 `json:"segment_and_index_comparisons_per_fetch"`
	ScannedBytesPerOp float64 `json:"scanned_wal_bytes_per_fetch"`
}

type runResult struct {
	Repeat      int           `json:"repeat"`
	Measurement measurement   `json:"measurement"`
	Brokers     []brokerUsage `json:"brokers_during_produce_window"`
	ReadBack    seekStats     `json:"read_back_index_seek"`
}

type configResult struct {
	Config          benchConfig `json:"config"`
	Workload        workload    `json:"workload"`
	Runs            []runResult `json:"runs"`
	RecoverySeconds float64     `json:"cold_restart_to_serving_seconds"`
	RecoveredWAL    int64       `json:"wal_bytes_per_replica_at_restart"`
}

// runConfig formats a fresh cluster, runs the repeats, then stops every
// broker and measures a cold restart until all partitions serve again.
func runConfig(l launcher, c benchConfig, w workload, repeats, runBase int) (configResult, error) {
	probe := &http.Client{Timeout: 5 * time.Second}
	result := configResult{Config: c, Workload: w}
	topology, err := c.topology(l)
	if err != nil {
		return result, err
	}
	if err := l.install(topology); err != nil {
		return result, err
	}
	defer func() {
		for _, id := range c.brokers() {
			_ = l.stop(id)
		}
	}()
	for _, id := range c.brokers() {
		if err := l.start(id, true); err != nil {
			return result, err
		}
	}
	if _, err := waitServing(probe, l, c, 60*time.Second); err != nil {
		return result, err
	}
	transport, err := newTransport(l, c)
	if err != nil {
		return result, err
	}
	for repeat := 1; repeat <= repeats; repeat++ {
		run, err := measure(probe, l, c, w, transport, runBase+repeat)
		if err != nil {
			return result, fmt.Errorf("%s repeat %d: %w", c.name(), repeat, err)
		}
		run.Repeat = repeat
		result.Runs = append(result.Runs, run)
		logf("%s repeat %d: %.0f records/s, produce p99 %.1f ms, fetch %.0f records/s",
			c.name(), repeat, run.Measurement.RecordsPerSec, run.Measurement.Produce.P99, run.Measurement.FetchPerSec)
	}
	for _, id := range c.brokers() {
		if err := l.stop(id); err != nil {
			return result, err
		}
	}
	for _, id := range c.brokers() {
		if err := l.start(id, false); err != nil {
			return result, err
		}
	}
	recovery, err := waitServing(probe, l, c, 5*time.Minute)
	if err != nil {
		return result, err
	}
	result.RecoverySeconds = recovery.Seconds()
	if values, err := scrape(probe, l.addresses(1).admin); err == nil {
		for partition := 0; partition < c.Partitions; partition++ {
			result.RecoveredWAL += int64(values[partitionSeries("mkfk_wal_bytes", partition)])
		}
	}
	return result, nil
}

func measure(probe *http.Client, l launcher, c benchConfig, w workload, transport *client.ClusterTransport, run int) (runResult, error) {
	windowStart := time.Now().Add(w.Warmup)
	windowEnd := windowStart.Add(w.Duration)
	var before, after []sample
	scrapeAll := func() ([]sample, error) {
		var samples []sample
		for _, id := range c.brokers() {
			values, err := scrape(probe, l.addresses(id).admin)
			if err != nil {
				return nil, err
			}
			samples = append(samples, values)
		}
		return samples, nil
	}
	scraped := make(chan error, 1)
	go func() {
		time.Sleep(time.Until(windowStart))
		var err error
		before, err = scrapeAll()
		time.Sleep(time.Until(windowEnd))
		if err == nil {
			after, err = scrapeAll()
		}
		scraped <- err
	}()
	recorded, err := produce(transport, w, run, windowStart, windowEnd)
	if err != nil {
		return runResult{}, err
	}
	if err := <-scraped; err != nil {
		return runResult{}, err
	}
	seconds := w.Duration.Seconds()
	result := runResult{Measurement: measurement{
		ProducedRecords: recorded.records, RecordsPerSec: float64(recorded.records) / seconds,
		BytesPerSec: float64(recorded.records*int64(w.RecordBytes)) / seconds,
		Produce:     summarize(recorded.latencies), ProduceErrors: recorded.errors,
	}}
	for index := range before {
		result.Brokers = append(result.Brokers, usage(fmt.Sprintf("node-%d", index+1), before[index], after[index], seconds, c.Partitions))
	}
	readStart, err := scrapeAll()
	if err != nil {
		return result, err
	}
	fetched, elapsed, latencies, err := readBack(transport, c.Partitions)
	if err != nil {
		return result, errors.Join(errors.New("read-back failed"), err)
	}
	readEnd, err := scrapeAll()
	if err != nil {
		return result, err
	}
	result.Measurement.FetchedRecords = fetched
	result.Measurement.FetchPerSec = float64(fetched) / elapsed.Seconds()
	result.Measurement.Fetch = summarize(latencies)
	result.ReadBack = seek(readStart, readEnd, c.Partitions)
	return result, nil
}

func usage(name string, before, after sample, seconds float64, partitions int) brokerUsage {
	result := brokerUsage{
		Broker:     name,
		CPUPercent: 100 * (after["mkfk_process_cpu_seconds_total"] - before["mkfk_process_cpu_seconds_total"]) / seconds,
		RSSBytes:   int64(after["mkfk_process_resident_bytes"]),
		Fsyncs:     int64(after["mkfk_fsync_total"] - before["mkfk_fsync_total"]),
		FsyncMaxMS: 1000 * after["mkfk_fsync_max_seconds"],
	}
	if result.Fsyncs > 0 {
		result.FsyncMeanMS = 1000 * (after["mkfk_fsync_seconds_total"] - before["mkfk_fsync_seconds_total"]) / float64(result.Fsyncs)
	}
	for partition := 0; partition < partitions; partition++ {
		result.WALBytes += int64(after[partitionSeries("mkfk_wal_bytes", partition)])
		result.IndexAnchors += int64(after[partitionSeries("mkfk_index_anchors", partition)])
	}
	return result
}

func seek(before, after []sample, partitions int) seekStats {
	var fetches, comparisons, scanned float64
	for index := range before {
		for partition := 0; partition < partitions; partition++ {
			delta := func(name string) float64 {
				series := partitionSeries(name, partition)
				return after[index][series] - before[index][series]
			}
			fetches += delta("mkfk_fetches_total")
			comparisons += delta("mkfk_fetch_seek_comparisons_total")
			scanned += delta("mkfk_fetch_scanned_bytes_total")
		}
	}
	if fetches == 0 {
		return seekStats{}
	}
	return seekStats{Fetches: int64(fetches), ComparisonsPerOp: comparisons / fetches, ScannedBytesPerOp: scanned / fetches}
}
