package fake

import (
	"errors"
	"slices"
	"sync"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type Lifecycle string

const (
	LifecycleQueued         Lifecycle = "Queued"
	LifecycleStarting       Lifecycle = "Starting"
	LifecycleRunning        Lifecycle = "Running"
	LifecycleSucceeded      Lifecycle = "Succeeded"
	LifecycleFailed         Lifecycle = "Failed"
	LifecycleCanceled       Lifecycle = "Canceled"
	LifecycleNeedsReconcile Lifecycle = "NeedsReconcile"
)

type SideEffectOutcome string

const (
	SideEffectNotApplicable SideEffectOutcome = "NotApplicable"
	SideEffectConfirmed     SideEffectOutcome = "Confirmed"
	SideEffectUnknown       SideEffectOutcome = "OutcomeUnknown"
)

type Rejection struct {
	Reason   string
	Kind     ObservationKind
	Sequence uint64
}

type WorkerSnapshot struct {
	Fence             Fence
	Lifecycle         Lifecycle
	SideEffectOutcome SideEffectOutcome
	NextSequence      uint64
	LastTick          uint64
	CancelRequested   bool
	LeaseExpired      bool
	Redispatches      uint64
	Accepted          []Observation
	Rejections        []Rejection
}

type Worker struct {
	mu                sync.Mutex
	fence             Fence
	lifecycle         Lifecycle
	sideEffectOutcome SideEffectOutcome
	nextSequence      uint64
	lastTick          uint64
	cancelRequested   bool
	leaseExpired      bool
	accepted          []Observation
	rejections        []Rejection
}

func NewWorker(fence Fence) (*Worker, error) {
	if !fence.valid() {
		return nil, ErrInvalidRequest
	}
	return &Worker{
		fence: fence, lifecycle: LifecycleQueued, sideEffectOutcome: SideEffectNotApplicable,
		nextSequence: 1,
	}, nil
}

func (worker *Worker) RequestCancellation(fence Fence) error {
	if worker == nil || !fence.valid() {
		return ErrInvalidRequest
	}
	worker.mu.Lock()
	defer worker.mu.Unlock()
	if err := worker.checkFence(fence, "cancel_request", ""); err != nil {
		worker.rejections = append(worker.rejections, Rejection{Reason: err.Error()})
		return err
	}
	if worker.terminal() || worker.leaseExpired {
		return ErrTerminalPublication
	}
	worker.cancelRequested = true
	worker.sideEffectOutcome = SideEffectUnknown
	return nil
}

func (worker *Worker) ExpireLease(fence Fence) error {
	if worker == nil || !fence.valid() {
		return ErrInvalidRequest
	}
	worker.mu.Lock()
	defer worker.mu.Unlock()
	if err := worker.checkFence(fence, "lease_expiry", ""); err != nil {
		worker.rejections = append(worker.rejections, Rejection{Reason: err.Error()})
		return err
	}
	if worker.terminal() {
		return ErrTerminalPublication
	}
	worker.leaseExpired = true
	worker.lifecycle = LifecycleNeedsReconcile
	worker.sideEffectOutcome = SideEffectUnknown
	return nil
}

func (worker *Worker) Accept(observation Observation) error {
	if worker == nil {
		return ErrInvalidRequest
	}
	worker.mu.Lock()
	defer worker.mu.Unlock()
	if !validObservation(observation) {
		worker.recordRejection(ErrInvalidRequest.Error(), observation)
		return ErrInvalidRequest
	}
	if err := worker.checkFence(observation.Fence, "observation_fence", observation.Kind); err != nil {
		worker.recordRejection(err.Error(), observation)
		return err
	}
	if observation.Sequence < worker.nextSequence {
		worker.recordRejection(ErrDuplicateObservation.Error(), observation)
		return ErrDuplicateObservation
	}
	if observation.Sequence > worker.nextSequence {
		worker.recordRejection(ErrObservationOrder.Error(), observation)
		return ErrObservationOrder
	}
	if observation.Tick < worker.lastTick {
		worker.recordRejection(ErrTickRegressed.Error(), observation)
		return ErrTickRegressed
	}
	if worker.leaseExpired && isTerminal(observation.Kind) || worker.terminal() {
		worker.recordRejection(ErrTerminalPublication.Error(), observation)
		return ErrTerminalPublication
	}
	if observation.Kind == ObservationLateResult || observation.Kind == ObservationStalePublication {
		worker.recordRejection(ErrTerminalPublication.Error(), observation)
		return ErrTerminalPublication
	}
	if err := worker.apply(observation); err != nil {
		worker.recordRejection(err.Error(), observation)
		return err
	}
	worker.accepted = append(worker.accepted, observation.clone())
	worker.nextSequence++
	worker.lastTick = observation.Tick
	return nil
}

func (worker *Worker) Snapshot() WorkerSnapshot {
	if worker == nil {
		return WorkerSnapshot{}
	}
	worker.mu.Lock()
	defer worker.mu.Unlock()
	return WorkerSnapshot{
		Fence: worker.fence, Lifecycle: worker.lifecycle, SideEffectOutcome: worker.sideEffectOutcome,
		NextSequence: worker.nextSequence, LastTick: worker.lastTick, CancelRequested: worker.cancelRequested,
		LeaseExpired: worker.leaseExpired, Redispatches: 0, Accepted: cloneObservations(worker.accepted),
		Rejections: slices.Clone(worker.rejections),
	}
}

func validObservation(observation Observation) bool {
	if !observation.Fence.valid() || !validObservationKind(observation.Kind) || observation.Sequence == 0 || len(observation.Message) > 4096 {
		return false
	}
	if observation.ArtifactName == "" {
		return observation.ArtifactDigest.IsZero() && len(observation.ArtifactBytes) == 0
	}
	return validRelativeName(observation.ArtifactName) && !observation.ArtifactDigest.IsZero() &&
		len(observation.ArtifactBytes) > 0 && domainDigestMatches(observation)
}

func domainDigestMatches(observation Observation) bool {
	return observation.ArtifactDigest == domain.HashBytes(observation.ArtifactBytes)
}

func (worker *Worker) apply(observation Observation) error {
	switch observation.Kind {
	case ObservationDispatchReceived:
		if worker.lifecycle != LifecycleQueued {
			return ErrObservationOrder
		}
		worker.lifecycle = LifecycleStarting
	case ObservationStartAcknowledged:
		if worker.lifecycle != LifecycleStarting {
			return ErrObservationOrder
		}
		worker.lifecycle = LifecycleRunning
	case ObservationStartLost:
		if worker.lifecycle != LifecycleStarting {
			return ErrObservationOrder
		}
		worker.lifecycle = LifecycleNeedsReconcile
		worker.sideEffectOutcome = SideEffectUnknown
	case ObservationLookupRunning:
		if worker.lifecycle != LifecycleNeedsReconcile {
			return ErrObservationOrder
		}
		worker.lifecycle = LifecycleRunning
	case ObservationLookupUnknown:
		if worker.lifecycle != LifecycleNeedsReconcile {
			return ErrObservationOrder
		}
		worker.lifecycle = LifecycleNeedsReconcile
		worker.sideEffectOutcome = SideEffectUnknown
	case ObservationHeartbeat, ObservationCheckpoint:
		if worker.lifecycle != LifecycleRunning {
			return ErrObservationOrder
		}
	case ObservationTerminalSuccess:
		if worker.lifecycle != LifecycleRunning {
			return ErrObservationOrder
		}
		worker.lifecycle = LifecycleSucceeded
		worker.sideEffectOutcome = SideEffectConfirmed
	case ObservationTerminalFailure:
		if worker.lifecycle != LifecycleRunning {
			return ErrObservationOrder
		}
		worker.lifecycle = LifecycleFailed
		worker.sideEffectOutcome = SideEffectConfirmed
	case ObservationTimeout, ObservationUnknownOutcome:
		if worker.lifecycle != LifecycleRunning {
			return ErrObservationOrder
		}
		worker.lifecycle = LifecycleNeedsReconcile
		worker.sideEffectOutcome = SideEffectUnknown
	case ObservationCancelAcknowledged:
		if !worker.cancelRequested || worker.lifecycle == LifecycleQueued {
			return errors.New("cancel acknowledgement without request")
		}
		worker.lifecycle = LifecycleCanceled
		worker.sideEffectOutcome = SideEffectConfirmed
	default:
		return ErrInvalidRequest
	}
	return nil
}

func (worker *Worker) checkFence(actual Fence, reason string, kind ObservationKind) error {
	if actual == worker.fence {
		return nil
	}
	return errors.Join(ErrFenceRejected, errors.New(reason+":"+string(kind)))
}

func (worker *Worker) recordRejection(reason string, observation Observation) {
	worker.rejections = append(worker.rejections, Rejection{Reason: reason, Kind: observation.Kind, Sequence: observation.Sequence})
}

func (worker *Worker) terminal() bool {
	return worker.lifecycle == LifecycleSucceeded || worker.lifecycle == LifecycleFailed || worker.lifecycle == LifecycleCanceled
}

func isTerminal(kind ObservationKind) bool {
	return kind == ObservationTerminalSuccess || kind == ObservationTerminalFailure || kind == ObservationCancelAcknowledged ||
		kind == ObservationLateResult || kind == ObservationStalePublication
}
