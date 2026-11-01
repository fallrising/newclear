package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

type benchConfig struct {
	RF         int `json:"replication_factor"`
	MinISR     int `json:"min_isr"`
	Batch      int `json:"batch_records"`
	Partitions int `json:"partitions"`
}

func (c benchConfig) name() string {
	return fmt.Sprintf("rf%d-isr%d-b%d-p%d", c.RF, c.MinISR, c.Batch, c.Partitions)
}

// matrixConfigs is the 04-validation §5 workload set.
func matrixConfigs() []benchConfig {
	var configs []benchConfig
	for _, replication := range [][2]int{{1, 1}, {3, 1}, {3, 2}} {
		for _, batch := range []int{1, 100} {
			for _, partitions := range []int{1, 3} {
				configs = append(configs, benchConfig{RF: replication[0], MinISR: replication[1], Batch: batch, Partitions: partitions})
			}
		}
	}
	return configs
}

func (c benchConfig) brokers() []uint32 {
	if c.RF == 1 {
		return []uint32{1}
	}
	return []uint32{1, 2, 3}
}

func (c benchConfig) topology(l launcher) ([]byte, error) {
	manifest := config.ClusterManifest{Version: 1, ClusterID: "mkfk-bench"}
	replicas := c.brokers()
	for _, id := range replicas {
		addresses := l.addresses(id)
		manifest.Brokers = append(manifest.Brokers, config.Broker{ID: id, ClientAddr: addresses.client, PeerAddr: addresses.peer, AdminAddr: addresses.admin})
	}
	events := config.Topic{Name: "events"}
	for id := 0; id < c.Partitions; id++ {
		events.Partitions = append(events.Partitions, config.Partition{ID: uint32(id), Replicas: replicas, MinISR: uint32(c.MinISR)})
	}
	groups := config.Topic{Name: "__mkfk_groups", Internal: true, Partitions: []config.Partition{{ID: 0, Replicas: replicas, MinISR: uint32(c.MinISR)}}}
	manifest.Topics = []config.Topic{events, groups}
	return json.MarshalIndent(manifest, "", "  ")
}

// sample is one /metrics scrape keyed by series, e.g.
// `mkfk_wal_bytes{topic="events",partition="0"}`.
type sample map[string]float64

func scrape(probe *http.Client, admin string) (sample, error) {
	response, err := probe.Get("http://" + admin + "/metrics")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	values := sample{}
	lines := bufio.NewScanner(response.Body)
	for lines.Scan() {
		series, raw, found := strings.Cut(lines.Text(), " ")
		if value, err := strconv.ParseFloat(raw, 64); found && err == nil {
			values[series] = value
		}
	}
	return values, lines.Err()
}

func partitionSeries(name string, partition int) string {
	return fmt.Sprintf(`%s{topic="events",partition="%d"}`, name, partition)
}

// serving reports whether every broker is ready and every partition,
// including the groups partition, has a ready leader.
func serving(probe *http.Client, l launcher, c benchConfig) bool {
	leaders := map[string]bool{}
	for _, id := range c.brokers() {
		values, err := scrape(probe, l.addresses(id).admin)
		if err != nil || values["mkfk_ready"] != 1 {
			return false
		}
		for series, value := range values {
			if strings.HasPrefix(series, "mkfk_leader_ready{") && value == 1 {
				leaders[series] = true
			}
		}
	}
	return len(leaders) == c.Partitions+1
}

func waitServing(probe *http.Client, l launcher, c benchConfig, timeout time.Duration) (time.Duration, error) {
	started := time.Now()
	for !serving(probe, l, c) {
		if time.Since(started) > timeout {
			return 0, fmt.Errorf("%s: cluster not serving after %s", c.name(), timeout)
		}
		time.Sleep(50 * time.Millisecond)
	}
	return time.Since(started), nil
}

func newTransport(l launcher, c benchConfig) (*client.ClusterTransport, error) {
	endpoints := map[uint32]string{}
	for _, id := range c.brokers() {
		endpoints[id] = "http://" + l.addresses(id).client
	}
	return client.NewClusterTransport(&http.Client{Timeout: 15 * time.Second}, endpoints)
}
