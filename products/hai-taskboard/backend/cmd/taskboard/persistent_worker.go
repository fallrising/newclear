package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
)

const workerLeaseDuration = 30 * time.Second

type persistentWorker struct {
	store    *sqlite.Store
	commands *service.Service
	executor *fake.Adapter
	clock    port.Clock
	holder   domain.ActorID
}

func (worker persistentWorker) run(ctx context.Context) error {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := worker.scan(ctx); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("persistent Fake worker: %w", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (worker persistentWorker) scan(ctx context.Context) error {
	candidates, err := worker.store.DispatchCandidates(ctx, worker.clock.Now(), 32)
	if err != nil {
		return err
	}
	for _, candidate := range candidates {
		if err := ctx.Err(); err != nil {
			return err
		}
		if candidate.Run.DispatchState != "Pending" {
			_, err := worker.commands.ClaimExpiredRunForReconciliation(ctx, worker.holder, service.ClaimReconciliationRequest{
				PreviousFence: candidate.Lease.Fence, Successor: worker.holder, LeaseDuration: workerLeaseDuration,
			})
			if errors.Is(err, port.ErrFenceRejected) || errors.Is(err, port.ErrLeaseNotExpired) || errors.Is(err, port.ErrRunLifecycle) {
				continue
			}
			if err != nil {
				return err
			}
			continue // Expiry proves no executor outcome; never redispatch.
		}
		envelope, err := worker.commands.ClaimDispatch(ctx, worker.holder, service.ClaimDispatchRequest{
			ProjectID: candidate.Run.ProjectID, RunID: candidate.Run.ID, Holder: worker.holder,
			ExpectedRestoreGeneration: candidate.RestoreGeneration, LeaseDuration: workerLeaseDuration,
		})
		if errors.Is(err, port.ErrNoPendingDispatch) || errors.Is(err, port.ErrFenceRejected) {
			continue
		}
		if err != nil {
			return err
		}
		if err := worker.execute(ctx, envelope); err != nil {
			return err
		}
	}
	return nil
}

func (worker persistentWorker) execute(ctx context.Context, envelope port.ExecutorEnvelope) error {
	if envelope.AdapterID != fake.AdapterID || envelope.AdapterVersion != fake.AdapterVersion || envelope.ScenarioID != "local-success" {
		return errors.New("unavailable local Fake scenario")
	}
	fence := fake.Fence{RunID: envelope.Fence.RunID, InputDigest: envelope.Fence.InputDigest,
		LeaseHolder: string(envelope.Fence.Holder), LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration}
	guard, err := fake.NewWorker(fence)
	if err != nil {
		return err
	}
	session, observations, err := worker.executor.Dispatch(ctx, fake.DispatchRequest{Fence: fence, ScenarioID: envelope.ScenarioID})
	if err != nil {
		return err
	}
	publish := func(observations []fake.Observation) error {
		for _, observation := range observations {
			if err := guard.Accept(observation); err != nil {
				return err
			}
			mediaType := ""
			if !observation.ArtifactDigest.IsZero() {
				mediaType = "text/plain"
			}
			_, err := worker.commands.PublishRunObservation(ctx, worker.holder, service.RunObservation{
				Fence: envelope.Fence, Kind: service.RunObservationKind(observation.Kind),
				ArtifactDigest: observation.ArtifactDigest, ArtifactMediaType: mediaType, ArtifactBytes: observation.ArtifactBytes,
			})
			if err != nil {
				return err
			}
		}
		return nil
	}
	if err := publish(observations); err != nil {
		return err
	}
	// The sole registered data-only scenario has exactly three deterministic
	// steps, ending at tick 2. No clock sleeps, external executors or retries.
	observations, err = session.Poll(ctx, fake.TickRequest{Fence: fence, Tick: 2})
	if err != nil {
		return err
	}
	return publish(observations)
}

// Fake staging is memory-only; fenced application publication owns durable
// artifact storage. No adapter-controlled path ever reaches the filesystem.
type localFakeStaging struct{}

func (localFakeStaging) Stage(ctx context.Context, _ domain.RunID, _, _ string, contents []byte) (domain.Digest, error) {
	if err := ctx.Err(); err != nil {
		return domain.Digest{}, err
	}
	return domain.HashBytes(contents), nil
}
