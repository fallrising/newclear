package service

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type artifactReadFailure struct {
	stage string
	cause error
}

func (e artifactReadFailure) Error() string { return "artifact " + e.stage + " failure" }
func (e artifactReadFailure) Unwrap() error { return e.cause }

// readArtifact preserves object absence and unexpected I/O causes. Command
// wrappers retain their original external messages and classifications.
func (s *Service) readArtifact(ctx context.Context, locator command.ArtifactLocator) error {
	return readArtifactWith(ctx, locator, s.artifacts.Open)
}

func (s *Service) readCoverageArtifact(ctx context.Context, locator command.ArtifactLocator) error {
	open := s.artifacts.Open
	if bounded, ok := s.artifacts.(port.BoundedArtifactReader); ok {
		open = func(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
			return bounded.OpenBounded(ctx, d, locator.ByteLength)
		}
	}
	return readArtifactWith(ctx, locator, open)
}

func readArtifactWith(ctx context.Context, locator command.ArtifactLocator, open func(context.Context, domain.Digest) (io.ReadCloser, error)) error {
	if locator.Availability != "Present" {
		return artifactReadFailure{"availability", port.ErrArtifactUnavailable}
	}
	reader, err := open(ctx, locator.Digest)
	if err != nil {
		return artifactReadFailure{"open", err}
	}
	defer reader.Close()
	content, err := io.ReadAll(io.LimitReader(reader, int64(locator.ByteLength)+1))
	if err != nil {
		return err
	}
	if uint64(len(content)) != locator.ByteLength || domain.HashBytes(content) != locator.Digest {
		return artifactReadFailure{"mismatch", port.ErrArtifactUnavailable}
	}
	return nil
}

func coverageArtifactMetadata(m port.CompletionMaterial) (map[domain.Digest]port.Artifact, error) {
	all := map[domain.Digest]port.Artifact{}
	for _, group := range [][]port.Artifact{m.CandidateArtifacts, m.Artifacts} {
		for _, artifact := range group {
			if artifact.StorageKey != artifactStorageKey(artifact.Digest) {
				return nil, domain.StorageCorruptionError{Reason: "invalid coverage artifact storage identity"}
			}
			if previous, ok := all[artifact.Digest]; ok && previous != artifact {
				return nil, domain.StorageCorruptionError{Reason: "conflicting coverage artifact metadata"}
			}
			all[artifact.Digest] = artifact
		}
	}
	return all, nil
}

func (s *Service) verifyCoverageMaterial(ctx context.Context, snapshot coverageSnapshot) (port.CompletionMaterial, error) {
	m := snapshot.Material
	m.Evidence = slices.Clone(m.Evidence)
	all, err := coverageArtifactMetadata(m)
	if err != nil {
		return m, err
	}
	seen := map[domain.Digest]error{}
	var bytes uint64
	attempts := 0
	verify := func(artifact port.Artifact) error {
		if outcome, ok := seen[artifact.Digest]; ok {
			return outcome
		}
		outcome := error(port.ErrArtifactUnavailable)
		if !artifact.Digest.IsZero() && artifact.Availability == "Present" && artifact.ByteLength <= maxRunArtifactBytes && artifact.ByteLength <= 50<<20-bytes && attempts < 1024 {
			attempts++
			bytes += artifact.ByteLength
			outcome = s.readCoverageArtifact(ctx, command.ArtifactLocator{Digest: artifact.Digest, MediaType: artifact.MediaType, ByteLength: artifact.ByteLength, Availability: artifact.Availability})
		}
		seen[artifact.Digest] = outcome
		return outcome
	}
	unavailable := func(err error) bool {
		return errors.Is(err, port.ErrArtifactUnavailable) || errors.Is(err, fs.ErrNotExist)
	}
	candidates := slices.Clone(m.CandidateArtifacts)
	slices.SortFunc(candidates, func(a, b port.Artifact) int { return strings.Compare(a.Digest.String(), b.Digest.String()) })
	bound := false
	m.CandidateAvailable = m.CandidatePresent && len(candidates) > 0
	for _, artifact := range candidates {
		err := verify(artifact)
		if err != nil {
			if !unavailable(err) {
				return m, err
			}
			m.CandidateAvailable = false
		}
		bound = bound || artifact.Digest == m.Candidate.Digest
	}
	m.CandidateAvailable = m.CandidateAvailable && bound
	slices.SortFunc(m.Evidence, func(a, b port.Evidence) int {
		if a.ID < b.ID {
			return -1
		}
		if a.ID > b.ID {
			return 1
		}
		return 0
	})
	for i, e := range m.Evidence {
		rule, required := snapshot.Policy.Checks[e.ACID]
		if !required || !slices.ContainsFunc(m.RequiredACRevisions, func(ac port.ACRequirement) bool { return ac.ACID == e.ACID && ac.RevisionDigest == e.ACRevisionDigest }) || e.SubjectDigest != snapshot.Subject.Digest() || e.VerifierClass != rule.VerifierClass || e.Verdict != "Passed" || e.Applicability != "Current" || e.Availability != "Present" || e.RecipeDigest != snapshot.Policy.RecipeDigest || e.EnvironmentDigest != rule.EnvironmentDigest {
			continue
		}
		artifact, exists := all[e.ArtifactDigest]
		if !exists || artifact.Availability != "Present" {
			m.Evidence[i].Availability = "Unavailable"
			continue
		}
		if err := verify(artifact); err != nil {
			if !unavailable(err) {
				return m, err
			}
			m.Evidence[i].Availability = "Unavailable"
		}
	}
	return m, nil
}
