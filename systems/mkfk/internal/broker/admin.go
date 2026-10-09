package broker

import (
	"context"
	"fmt"
	"net/http"
	"runtime"
	"sort"
	"strings"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// adminMux serves /healthz (the process answers), /readyz (recovered,
// listening, no failed partition; not "leads everything"), and /metrics
// in Prometheus text format. Nothing here carries payloads or credentials.
func (b *Broker) adminMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(response http.ResponseWriter, _ *http.Request) {
		writeText(response, http.StatusOK, "ok\n")
	})
	mux.HandleFunc("/readyz", func(response http.ResponseWriter, _ *http.Request) {
		if b.Ready() {
			writeText(response, http.StatusOK, "ready\n")
			return
		}
		writeText(response, http.StatusServiceUnavailable, "not ready\n")
	})
	mux.HandleFunc("/metrics", func(response http.ResponseWriter, request *http.Request) {
		writeText(response, http.StatusOK, b.metricsText(request.Context()))
	})
	return mux
}

func (b *Broker) metricsText(ctx context.Context) string {
	var out strings.Builder
	ready := 0
	if b.Ready() {
		ready = 1
	}
	fmt.Fprintf(&out, "mkfk_ready %d\n", ready)
	fmt.Fprintf(&out, "mkfk_goroutines %d\n", runtime.NumGoroutine())
	if cpu, rss, ok := processUsage(); ok {
		fmt.Fprintf(&out, "mkfk_process_cpu_seconds_total %.2f\nmkfk_process_resident_bytes %d\n", cpu, rss)
	}
	syncs := adapters.ReadSyncStats()
	fmt.Fprintf(&out, "mkfk_fsync_total %d\nmkfk_fsync_slow_total %d\nmkfk_fsync_seconds_total %.6f\nmkfk_fsync_max_seconds %.6f\n",
		syncs.Count, syncs.Slow, syncs.Total.Seconds(), syncs.Max.Seconds())
	for _, key := range b.sortedReplicaKeys() {
		r := b.replicas[key]
		var metrics partition.Metrics
		var err error
		if r.data != nil {
			metrics, err = r.data.Metrics(ctx)
		} else {
			metrics, err = r.actor.Metrics(ctx)
		}
		if err != nil {
			continue
		}
		labels := fmt.Sprintf(`topic=%q,partition="%d"`, r.topic, r.partition)
		snapshot := metrics.Snapshot
		gauge := func(name string, value any) { fmt.Fprintf(&out, "mkfk_%s{%s} %v\n", name, labels, value) }
		gauge("leader", boolMetric(snapshot.Role == raft.Leader))
		gauge("leader_ready", boolMetric(snapshot.LeaderReady))
		gauge("term", snapshot.Term)
		gauge("leader_id", snapshot.LeaderID)
		gauge("durable_log_index", snapshot.LastLogIndex)
		gauge("commit_index", snapshot.CommitIndex)
		gauge("last_applied", snapshot.LastApplied)
		gauge("pending_reads", metrics.PendingReads)
		gauge("inbox_dropped_total", metrics.InboxDropped)
		gauge("actor_stall_total", metrics.Stalls)
		gauge("actor_stall_max_seconds", fmt.Sprintf("%.6f", metrics.StallMax.Seconds()))
		gauge("peer_messages_rejected_total", metrics.RejectedPeerMsg)
		gauge("failed", boolMetric(metrics.Failed))
		var logBytes int64
		anchors := 0
		for _, segment := range r.log.Segments() {
			logBytes += segment.SizeBytes
			anchors += segment.AnchorCount
		}
		gauge("wal_bytes", logBytes)
		gauge("index_anchors", anchors)
		if r.data != nil {
			gauge("fetches_total", metrics.Fetches)
			gauge("fetch_seek_comparisons_total", metrics.FetchSeek)
			gauge("fetch_scanned_bytes_total", metrics.FetchScanBytes)
			gauge("log_end_offset", metrics.LogEndOffset)
			gauge("high_watermark", metrics.HighWatermark)
			gauge("isr_size", metrics.ISRSize)
			gauge("pending_ack_waiters", metrics.PendingOps)
			gauge("pending_bytes", metrics.PendingBytes)
		}
		if r.outbox != nil {
			gauge("outbox_dropped_total", r.outbox.Dropped())
			gauge("outbox_failed_total", r.outbox.Failed())
		}
	}
	return out.String()
}

// Metadata reports the leaders this broker observes for its replicas.
func (c clientBackend) Metadata(ctx context.Context) (protocol.MetadataResponseData, error) {
	b := c.b
	data := protocol.MetadataResponseData{ClusterID: b.manifest.ClusterID, ConfigSHA256: b.configHash}
	for _, broker := range b.manifest.Brokers {
		data.Brokers = append(data.Brokers, protocol.MetadataBroker{ID: broker.ID, ClientAddr: broker.ClientAddr})
	}
	for _, topic := range b.manifest.Topics {
		for _, spec := range topic.Partitions {
			leaderID, term := b.observedLeader(ctx, topic.Name, spec.ID)
			if topic.Internal {
				data.Coordinator = leaderID
				continue
			}
			data.Partitions = append(data.Partitions, protocol.MetadataPartition{
				Topic: topic.Name, Partition: spec.ID, Replicas: append([]uint32(nil), spec.Replicas...),
				LeaderID: leaderID, LeaderTerm: term,
			})
		}
	}
	return data, nil
}

func (b *Broker) observedLeader(ctx context.Context, topic string, id uint32) (*uint32, *protocol.DecimalUint64) {
	r := b.replica(topic, id)
	if r == nil {
		return nil, nil
	}
	snapshot, err := r.actor.Snapshot(ctx)
	if err != nil || snapshot.LeaderID == 0 {
		return nil, nil
	}
	leader, term := snapshot.LeaderID, protocol.DecimalUint64(snapshot.Term)
	return &leader, &term
}

func (b *Broker) sortedReplicaKeys() []string {
	keys := make([]string, 0, len(b.replicas))
	for key := range b.replicas {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func boolMetric(value bool) int {
	if value {
		return 1
	}
	return 0
}

func writeText(response http.ResponseWriter, status int, body string) {
	response.Header().Set("Content-Type", "text/plain; version=0.0.4")
	response.WriteHeader(status)
	_, _ = response.Write([]byte(body))
}
