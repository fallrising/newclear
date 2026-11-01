package protocol

type MetadataBroker struct {
	ID         uint32 `json:"id"`
	ClientAddr string `json:"client_addr"`
}

// MetadataPartition reports the leader this broker last observed; a broker
// without a replica reports null for both.
type MetadataPartition struct {
	Topic      string         `json:"topic"`
	Partition  uint32         `json:"partition"`
	Replicas   []uint32       `json:"replicas"`
	LeaderID   *uint32        `json:"leader_id"`
	LeaderTerm *DecimalUint64 `json:"leader_term"`
}

type MetadataResponseData struct {
	ClusterID    string              `json:"cluster_id"`
	ConfigSHA256 string              `json:"config_sha256"`
	Brokers      []MetadataBroker    `json:"brokers"`
	Partitions   []MetadataPartition `json:"partitions"`
	Coordinator  *uint32             `json:"coordinator"`
}

type MetadataResponse struct {
	RequestID string               `json:"request_id"`
	Data      MetadataResponseData `json:"data"`
}
