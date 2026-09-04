package fleetfile

// Document is a fleet.yaml / fleet JSON service contract.
type Document struct {
	APIVersion string   `json:"apiVersion" yaml:"apiVersion"`
	Kind       string   `json:"kind" yaml:"kind"`
	Metadata   Metadata `json:"metadata" yaml:"metadata"`
	Spec       Spec     `json:"spec" yaml:"spec"`
}

type Metadata struct {
	Name        string            `json:"name" yaml:"name"`
	Description string            `json:"description,omitempty" yaml:"description,omitempty"`
	Labels      map[string]string `json:"labels,omitempty" yaml:"labels,omitempty"`
}

type Spec struct {
	Node         string            `json:"node" yaml:"node"`
	Image        string            `json:"image,omitempty" yaml:"image,omitempty"`
	DesiredState string            `json:"desiredState,omitempty" yaml:"desiredState,omitempty"`
	Replicas     *int              `json:"replicas,omitempty" yaml:"replicas,omitempty"`
	Command      []string          `json:"command,omitempty" yaml:"command,omitempty"`
	Args         []string          `json:"args,omitempty" yaml:"args,omitempty"`
	WorkingDir   string            `json:"workingDir,omitempty" yaml:"workingDir,omitempty"`
	User         string            `json:"user,omitempty" yaml:"user,omitempty"`
	Expose       Expose            `json:"expose" yaml:"expose"`
	Env          map[string]string `json:"env,omitempty" yaml:"env,omitempty"`
	Secrets      []string          `json:"secrets,omitempty" yaml:"secrets,omitempty"`
	Volumes      []Volume          `json:"volumes,omitempty" yaml:"volumes,omitempty"`
	Resources    *Resources        `json:"resources,omitempty" yaml:"resources,omitempty"`
}

type Expose struct {
	Mode       string `json:"mode" yaml:"mode"`
	Hostname   string `json:"hostname,omitempty" yaml:"hostname,omitempty"`
	Port       int    `json:"port" yaml:"port"`
	HealthPath string `json:"healthPath,omitempty" yaml:"healthPath,omitempty"`
}

type Volume struct {
	Name  string `json:"name" yaml:"name"`
	Mount string `json:"mount" yaml:"mount"`
}

type Resources struct {
	Memory string `json:"memory,omitempty" yaml:"memory,omitempty"`
	CPUs   string `json:"cpus,omitempty" yaml:"cpus,omitempty"`
}

// ReservedNames cannot be used as metadata.name.
var ReservedNames = map[string]struct{}{
	"agent":       {},
	"control":     {},
	"fleetd":      {},
	"fleet-agent": {},
	"ui":          {},
}

const (
	APIVersionV1 = "fleet.catalog/v1"
	KindService  = "Service"

	ModePublic  = "public"
	ModeAccess  = "access"
	ModePrivate = "private"

	StateRunning = "running"
	StateStopped = "stopped"
	StateAbsent  = "absent"

	LabelLargeOrigin = "fleet.catalog/large-origin"
	PrivateSuffix    = ".fleet.internal"
)
