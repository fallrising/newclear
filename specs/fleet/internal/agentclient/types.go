package agentclient

type Desired struct {
	NodeID                string            `json:"node_id"`
	Generation            int64             `json:"generation"`
	ReconcileAfterSeconds int               `json:"reconcile_after_seconds"`
	Registry              *Registry         `json:"registry,omitempty"`
	Services              []DesiredService  `json:"services"`
}

type Registry struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type DesiredService struct {
	Name           string   `json:"name"`
	DesiredState   string   `json:"desired_state"`
	Generation     int64    `json:"generation"`
	ForceRecreate  bool     `json:"force_recreate"`
	PurgeVolumes   bool     `json:"purge_volumes"`
	ComposeProject string   `json:"compose_project"`
	HostPort       int      `json:"host_port"`
	ComposeYAML    string   `json:"compose_yaml"`
	EnvFile        string   `json:"env_file"`
	SecretKeys     []string `json:"secret_keys"`
	Image          string   `json:"image"`
	Health         Health   `json:"health"`
}

type Health struct {
	URL       string `json:"url"`
	TimeoutMS int    `json:"timeout_ms"`
}

type Actual struct {
	NodeID           string          `json:"node_id"`
	AgentInstanceID  string          `json:"agent_instance_id"`
	Services         []ActualService `json:"services"`
}

type ActualService struct {
	Name              string `json:"name"`
	AppliedGeneration int64  `json:"applied_generation"`
	ActualState       string `json:"actual_state"`
	Health            string `json:"health"`
	HealthDetail      string `json:"health_detail"`
	ContainerID       string `json:"container_id"`
	Image             string `json:"image"`
	Error             string `json:"error"`
}

type Heartbeat struct {
	AgentInstanceID string         `json:"agent_instance_id"`
	AgentVersion    string         `json:"agent_version"`
	Facts           map[string]any `json:"facts"`
}
