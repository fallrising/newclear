package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// violations checks the run's history against the final committed logs:
// acknowledged batches are present exactly once and in order, retries never
// duplicate, every record reached every group, assignments within one
// generation never overlap, and sampled committed offsets never regress.
func (h *history) violations(final map[uint32][]string) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var found []string
	for partition, values := range final {
		position := map[string]int{}
		for index, value := range values {
			if _, seen := position[value]; seen {
				found = append(found, fmt.Sprintf("events/%d holds %q twice", partition, value))
			}
			position[value] = index
			if !h.attempted[value] {
				found = append(found, fmt.Sprintf("events/%d holds %q, which no producer sent", partition, value))
			}
		}
		last := -1
		for _, value := range h.acked[partition] {
			index, present := position[value]
			if !present {
				found = append(found, fmt.Sprintf("acknowledged %q is missing from events/%d", value, partition))
				continue
			}
			if index < last {
				found = append(found, fmt.Sprintf("acknowledged %q is out of order in events/%d", value, partition))
			}
			last = index
		}
		for group, processed := range h.processed {
			for _, value := range values {
				if processed[value] == 0 {
					found = append(found, fmt.Sprintf("group %s never processed %q", group, value))
				}
			}
		}
	}
	for group, generations := range h.assignments {
		for generation, members := range generations {
			owner := map[uint32]string{}
			for member, partitions := range members {
				for _, partition := range partitions {
					if other, taken := owner[partition]; taken {
						found = append(found, fmt.Sprintf("group %s generation %d gave events/%d to %s and %s", group, generation, partition, other, member))
					}
					owner[partition] = member
				}
			}
		}
	}
	for group, partitions := range h.committed {
		for partition, samples := range partitions {
			for index := 1; index < len(samples); index++ {
				if samples[index] < samples[index-1] {
					found = append(found, fmt.Sprintf("group %s events/%d committed offset went back %d -> %d", group, partition, samples[index-1], samples[index]))
				}
			}
		}
	}
	sort.Strings(found)
	return found
}

// replicaValues reads one stopped broker's local copy of a partition.
func replicaValues(t *testing.T, cluster *testCluster, id, partition uint32) []string {
	t.Helper()
	dataDir, err := storage.OpenDataDir(cluster.dataDir(id), id, cluster.topology(t))
	if err != nil {
		t.Fatal(err)
	}
	defer dataDir.Close()
	log, err := dataDir.OpenPartition("events", partition)
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	var values []string
	for offset := uint64(0); offset < log.LEO(); {
		records, next, err := log.ReadLocalRecords(offset, storage.MaxLocalReadBytes)
		if err != nil {
			t.Fatal(err)
		}
		for _, record := range records {
			values = append(values, string(record.Value))
		}
		if next == offset {
			break
		}
		offset = next
	}
	return values
}

// writeReport saves a scrubbed run summary for the evidence manifest when
// MKFK_CHAOS_REPORT names a file. It holds counts and the fault timeline,
// never record payloads beyond the synthetic value labels.
func writeReport(t *testing.T, report map[string]any) {
	t.Helper()
	path := os.Getenv("MKFK_CHAOS_REPORT")
	if path == "" {
		return
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}
