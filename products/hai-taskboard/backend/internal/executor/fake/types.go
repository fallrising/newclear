// Package fake provides the deterministic, data-only P0-A executor.
package fake

import (
	"errors"
	"mime"
	"path"
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const (
	AdapterID      = "fake/v1"
	AdapterVersion = "1"
)

var (
	ErrInvalidScenario       = errors.New("invalid fake scenario")
	ErrInvalidRequest        = errors.New("invalid fake request")
	ErrCapabilityUnsupported = errors.New("capability_unsupported")
	ErrTickRegressed         = errors.New("fake tick regressed")
	ErrFenceRejected         = errors.New("fake observation fence rejected")
	ErrDuplicateObservation  = errors.New("duplicate fake observation")
	ErrObservationOrder      = errors.New("fake observation out of order")
	ErrTerminalPublication   = errors.New("fake terminal publication rejected")
)

type Capability string

const (
	CapabilityStartAck          Capability = "start_ack"
	CapabilityHeartbeat         Capability = "heartbeat"
	CapabilityLookup            Capability = "lookup"
	CapabilityCancelAck         Capability = "cancel_ack"
	CapabilityDurableCheckpoint Capability = "durable_checkpoint"
)

type ObservationKind string

const (
	ObservationDispatchReceived   ObservationKind = "dispatch_received"
	ObservationStartAcknowledged  ObservationKind = "start_acknowledged"
	ObservationStartLost          ObservationKind = "start_lost"
	ObservationHeartbeat          ObservationKind = "heartbeat"
	ObservationCheckpoint         ObservationKind = "checkpoint"
	ObservationTerminalSuccess    ObservationKind = "terminal_success"
	ObservationTerminalFailure    ObservationKind = "terminal_failure"
	ObservationTimeout            ObservationKind = "timeout"
	ObservationLateResult         ObservationKind = "late_result"
	ObservationStalePublication   ObservationKind = "stale_publication"
	ObservationLookupRunning      ObservationKind = "lookup_running"
	ObservationLookupUnknown      ObservationKind = "lookup_unknown"
	ObservationCancelAcknowledged ObservationKind = "cancel_acknowledged"
	ObservationUnknownOutcome     ObservationKind = "unknown_outcome"
)

type Artifact struct {
	Name      string
	MediaType string
	Bytes     []byte
}

func (artifact Artifact) clone() Artifact {
	artifact.Bytes = slices.Clone(artifact.Bytes)
	return artifact
}

type Step struct {
	Tick     uint64
	Kind     ObservationKind
	Message  string
	Artifact *Artifact
}

func (step Step) clone() Step {
	if step.Artifact != nil {
		artifact := step.Artifact.clone()
		step.Artifact = &artifact
	}
	return step
}

type Scenario struct {
	id           string
	capabilities []Capability
	steps        []Step
}

func NewScenario(id string, capabilities []Capability, steps []Step) (Scenario, error) {
	if !validToken(id) || len(steps) == 0 {
		return Scenario{}, ErrInvalidScenario
	}
	normalized, err := normalizeCapabilities(capabilities)
	if err != nil {
		return Scenario{}, err
	}
	copied := make([]Step, len(steps))
	for index, step := range steps {
		copied[index] = step.clone()
		if !validStep(step, normalized) || index > 0 && step.Tick < steps[index-1].Tick {
			return Scenario{}, ErrInvalidScenario
		}
	}
	if copied[0].Tick != 0 || copied[0].Kind != ObservationDispatchReceived {
		return Scenario{}, ErrInvalidScenario
	}
	for _, step := range copied[1:] {
		if step.Kind == ObservationDispatchReceived {
			return Scenario{}, ErrInvalidScenario
		}
	}
	return Scenario{id: id, capabilities: normalized, steps: copied}, nil
}

func (scenario Scenario) ID() string { return scenario.id }

func (scenario Scenario) Capabilities() []Capability {
	return slices.Clone(scenario.capabilities)
}

func (scenario Scenario) Steps() []Step {
	result := make([]Step, len(scenario.steps))
	for index, step := range scenario.steps {
		result[index] = step.clone()
	}
	return result
}

func (scenario Scenario) clone() Scenario {
	return Scenario{id: scenario.id, capabilities: scenario.Capabilities(), steps: scenario.Steps()}
}

type Fence struct {
	RunID             domain.RunID
	InputDigest       domain.Digest
	LeaseHolder       string
	LeaseEpoch        uint64
	RestoreGeneration uint64
}

func (fence Fence) valid() bool {
	return validToken(string(fence.RunID)) && !fence.InputDigest.IsZero() && validToken(fence.LeaseHolder) &&
		fence.LeaseEpoch > 0 && fence.RestoreGeneration > 0
}

type DispatchRequest struct {
	Fence      Fence
	ScenarioID string
}

type TickRequest struct {
	Fence Fence
	Tick  uint64
}

type Observation struct {
	Fence          Fence
	Sequence       uint64
	Tick           uint64
	Kind           ObservationKind
	Message        string
	ArtifactName   string
	ArtifactDigest domain.Digest
	ArtifactBytes  []byte
}

func (observation Observation) clone() Observation {
	observation.ArtifactBytes = slices.Clone(observation.ArtifactBytes)
	return observation
}

func normalizeCapabilities(capabilities []Capability) ([]Capability, error) {
	result := slices.Clone(capabilities)
	slices.Sort(result)
	for index, capability := range result {
		if !validCapability(capability) || index > 0 && capability == result[index-1] {
			return nil, ErrInvalidScenario
		}
	}
	return result, nil
}

func validCapability(capability Capability) bool {
	switch capability {
	case CapabilityStartAck, CapabilityHeartbeat, CapabilityLookup, CapabilityCancelAck, CapabilityDurableCheckpoint:
		return true
	default:
		return false
	}
}

func validStep(step Step, capabilities []Capability) bool {
	if !validObservationKind(step.Kind) || len(step.Message) > 4096 {
		return false
	}
	required := capabilityFor(step.Kind)
	if required != "" && !slices.Contains(capabilities, required) {
		return false
	}
	if step.Artifact != nil {
		if !validRelativeName(step.Artifact.Name) || !validMediaType(step.Artifact.MediaType) || len(step.Artifact.Bytes) == 0 {
			return false
		}
	}
	return true
}

func validObservationKind(kind ObservationKind) bool {
	switch kind {
	case ObservationDispatchReceived, ObservationStartAcknowledged, ObservationStartLost,
		ObservationHeartbeat, ObservationCheckpoint, ObservationTerminalSuccess,
		ObservationTerminalFailure, ObservationTimeout, ObservationLateResult,
		ObservationStalePublication, ObservationLookupRunning, ObservationLookupUnknown,
		ObservationCancelAcknowledged, ObservationUnknownOutcome:
		return true
	default:
		return false
	}
}

func capabilityFor(kind ObservationKind) Capability {
	switch kind {
	case ObservationStartAcknowledged, ObservationStartLost:
		return CapabilityStartAck
	case ObservationHeartbeat:
		return CapabilityHeartbeat
	case ObservationCheckpoint:
		return CapabilityDurableCheckpoint
	case ObservationLookupRunning, ObservationLookupUnknown:
		return CapabilityLookup
	case ObservationCancelAcknowledged:
		return CapabilityCancelAck
	default:
		return ""
	}
}

func validToken(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || strings.ContainsRune("._-", character) {
			continue
		}
		return false
	}
	return true
}

func validRelativeName(name string) bool {
	return name != "" && len(name) <= 256 && !path.IsAbs(name) && path.Clean(name) == name && name != "." && name != ".." &&
		!strings.HasPrefix(name, "../") && !strings.ContainsAny(name, "\\:\x00")
}

func validMediaType(value string) bool {
	if value == "" || len(value) > 128 || strings.ContainsAny(value, "\r\n\x00") {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && mediaType != ""
}
