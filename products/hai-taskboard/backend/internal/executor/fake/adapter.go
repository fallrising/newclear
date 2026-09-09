package fake

import (
	"context"
	"errors"
	"slices"
	"sync"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// StagingWriter is the only way Fake can publish bytes. Implementations receive
// a validated relative name and must confine it to the supplied Run staging area.
type StagingWriter interface {
	Stage(context.Context, domain.RunID, string, string, []byte) (domain.Digest, error)
}

type Adapter struct {
	declaration port.ExecutorDeclaration
	scenarios   map[string]Scenario
	writer      StagingWriter
}

var _ port.Executor = (*Adapter)(nil)

func NewAdapter(capabilities []Capability, scenarios []Scenario, writer StagingWriter) (*Adapter, error) {
	normalized, err := normalizeCapabilities(capabilities)
	if err != nil || len(scenarios) == 0 {
		return nil, ErrInvalidScenario
	}
	registered := make(map[string]Scenario, len(scenarios))
	needsWriter := false
	for _, scenario := range scenarios {
		if !validToken(scenario.id) || len(scenario.steps) == 0 {
			return nil, ErrInvalidScenario
		}
		if _, duplicate := registered[scenario.id]; duplicate {
			return nil, ErrInvalidScenario
		}
		for _, capability := range scenario.capabilities {
			if !slices.Contains(normalized, capability) {
				return nil, ErrCapabilityUnsupported
			}
		}
		for _, step := range scenario.steps {
			needsWriter = needsWriter || step.Artifact != nil
		}
		registered[scenario.id] = scenario.clone()
	}
	if needsWriter && writer == nil {
		return nil, ErrInvalidScenario
	}
	declared := make([]string, len(normalized))
	for index, capability := range normalized {
		declared[index] = string(capability)
	}
	return &Adapter{
		declaration: port.ExecutorDeclaration{AdapterID: AdapterID, AdapterVersion: AdapterVersion, Capabilities: declared},
		scenarios:   registered,
		writer:      writer,
	}, nil
}

func (adapter *Adapter) Declaration() port.ExecutorDeclaration {
	if adapter == nil {
		return port.ExecutorDeclaration{}
	}
	return adapter.declaration.Clone()
}

func (adapter *Adapter) Dispatch(ctx context.Context, request DispatchRequest) (*Session, []Observation, error) {
	if err := contextError(ctx); err != nil {
		return nil, nil, err
	}
	if adapter == nil || !request.Fence.valid() || !validToken(request.ScenarioID) {
		return nil, nil, ErrInvalidRequest
	}
	scenario, exists := adapter.scenarios[request.ScenarioID]
	if !exists {
		return nil, nil, ErrInvalidRequest
	}
	session := &Session{scenario: scenario.clone(), fence: request.Fence, writer: adapter.writer}
	observations, err := session.emit(ctx, 0, operationDispatch)
	if err != nil {
		return nil, nil, err
	}
	return session, observations, nil
}

type sessionOperation uint8

const (
	operationDispatch sessionOperation = iota
	operationPoll
	operationLookup
	operationCancel
)

type Session struct {
	mu         sync.Mutex
	scenario   Scenario
	fence      Fence
	writer     StagingWriter
	next       int
	lastTick   uint64
	transcript []Observation
	rejections []Rejection
}

func (session *Session) Poll(ctx context.Context, request TickRequest) ([]Observation, error) {
	return session.run(ctx, request, operationPoll, "")
}

func (session *Session) Lookup(ctx context.Context, request TickRequest) ([]Observation, error) {
	return session.run(ctx, request, operationLookup, CapabilityLookup)
}

func (session *Session) RequestCancel(ctx context.Context, request TickRequest) ([]Observation, error) {
	return session.run(ctx, request, operationCancel, CapabilityCancelAck)
}

func (session *Session) run(ctx context.Context, request TickRequest, operation sessionOperation, capability Capability) ([]Observation, error) {
	if err := contextError(ctx); err != nil {
		return nil, err
	}
	if session == nil || !request.Fence.valid() {
		return nil, ErrInvalidRequest
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	if capability != "" && !slices.Contains(session.scenario.capabilities, capability) {
		return nil, ErrCapabilityUnsupported
	}
	if request.Fence != session.fence {
		session.rejections = append(session.rejections, Rejection{Reason: ErrFenceRejected.Error()})
		return nil, ErrFenceRejected
	}
	if request.Tick < session.lastTick {
		return nil, ErrTickRegressed
	}
	return session.emitLocked(ctx, request.Tick, operation)
}

func (session *Session) Transcript() []Observation {
	if session == nil {
		return nil
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	return cloneObservations(session.transcript)
}

func (session *Session) Rejections() []Rejection {
	if session == nil {
		return nil
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	return slices.Clone(session.rejections)
}

func (session *Session) Cursor() (next int, tick uint64) {
	if session == nil {
		return 0, 0
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.next, session.lastTick
}

func (session *Session) emit(ctx context.Context, tick uint64, operation sessionOperation) ([]Observation, error) {
	session.mu.Lock()
	defer session.mu.Unlock()
	return session.emitLocked(ctx, tick, operation)
}

func (session *Session) emitLocked(ctx context.Context, tick uint64, operation sessionOperation) ([]Observation, error) {
	start := session.next
	result := make([]Observation, 0)
	for session.next < len(session.scenario.steps) {
		step := session.scenario.steps[session.next]
		if step.Tick > tick || operationFor(step.Kind) != operation {
			break
		}
		observation := Observation{
			Fence: session.fence, Sequence: uint64(session.next + 1), Tick: step.Tick,
			Kind: step.Kind, Message: step.Message,
		}
		if step.Artifact != nil {
			bytes := slices.Clone(step.Artifact.Bytes)
			digest, err := session.writer.Stage(ctx, session.fence.RunID, step.Artifact.Name, step.Artifact.MediaType, bytes)
			if err != nil {
				session.next = start
				return nil, err
			}
			if digest != domain.HashBytes(bytes) {
				session.next = start
				return nil, errors.New("staging writer returned mismatched digest")
			}
			observation.ArtifactName = step.Artifact.Name
			observation.ArtifactDigest = digest
			observation.ArtifactBytes = bytes
		}
		result = append(result, observation)
		session.next++
	}
	session.lastTick = tick
	session.transcript = append(session.transcript, cloneObservations(result)...)
	return cloneObservations(result), nil
}

func operationFor(kind ObservationKind) sessionOperation {
	switch kind {
	case ObservationDispatchReceived:
		return operationDispatch
	case ObservationLookupRunning, ObservationLookupUnknown:
		return operationLookup
	case ObservationCancelAcknowledged:
		return operationCancel
	default:
		return operationPoll
	}
}

func cloneObservations(observations []Observation) []Observation {
	result := make([]Observation, len(observations))
	for index, observation := range observations {
		result[index] = observation.clone()
	}
	return result
}

func contextError(ctx context.Context) error {
	if ctx == nil {
		return ErrInvalidRequest
	}
	return ctx.Err()
}
