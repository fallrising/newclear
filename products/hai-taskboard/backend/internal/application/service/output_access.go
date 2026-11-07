package service

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"io"
	"math"
	"mime"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func outputAccessCorruption() error {
	return domain.StorageCorruptionError{Reason: "Run output metadata or content is invalid"}
}
func outputAccessUnavailable() error {
	return command.NewError(command.CodeProjectionUnavailable, "output access is unavailable", true, nil, nil)
}
func outputAccessReader(tx port.Transaction) (port.RunOutputReadTransaction, error) {
	reader, ok := tx.(port.RunOutputReadTransaction)
	if !ok {
		return nil, outputAccessUnavailable()
	}
	return reader, nil
}
func validOutputMetadata(o port.RunOutput, project domain.ProjectID, run domain.RunID) bool {
	a := o.Artifact
	media, params, err := mime.ParseMediaType(a.MediaType)
	return o.ProjectID == project && o.RunID == run && run != "" && !o.InputDigest.IsZero() && !o.ArtifactDigest.IsZero() && o.ArtifactDigest == a.Digest && o.LeaseEpoch > 0 && o.LeaseEpoch <= math.MaxInt64 && o.RestoreGeneration > 0 && o.RestoreGeneration <= math.MaxInt64 && a.ByteLength <= maxRunArtifactBytes && a.Availability == "Present" && a.StorageKey == artifactStorageKey(a.Digest) && err == nil && strings.Count(media, "/") == 1 && len(a.MediaType) <= 160 && !strings.ContainsRune(a.MediaType, 0) && mime.FormatMediaType(media, params) == a.MediaType
}
func outputDownloadMediaAllowed(value string) bool {
	media, params, err := mime.ParseMediaType(value)
	if err != nil {
		return false
	}
	switch media {
	case "application/octet-stream":
		return len(params) == 0
	case "text/plain", "text/markdown", "application/json":
		return len(params) == 0 || len(params) == 1 && strings.EqualFold(params["charset"], "utf-8")
	default:
		return false
	}
}

// DescribeRunOutputs exposes immutable history, not current execution authority
// or candidate/completion eligibility. This read never opens object bytes.
func (s *Service) DescribeRunOutputs(ctx context.Context, actor domain.ActorID, project domain.ProjectID, item domain.WorkItemID, run domain.RunID) ([]byte, error) {
	if actor == "" || actor != s.config.Operator || project == "" || item == "" || run == "" {
		return nil, port.ErrNotFound
	}
	var outputs []port.RunOutput
	err := s.unit.Within(ctx, func(tx port.Transaction) error {
		reader, err := outputAccessReader(tx)
		if err != nil {
			return err
		}
		outputs, err = reader.LoadScopedRunOutputs(ctx, project, item, run)
		return err
	})
	if err != nil {
		return nil, err
	}
	if len(outputs) > port.RunOutputLimit {
		return nil, outputAccessCorruption()
	}
	entries := make([]map[string]any, 0, len(outputs))
	previous := ""
	for _, o := range outputs {
		digest := "sha256:" + o.ArtifactDigest.String()
		if !validOutputMetadata(o, project, run) || digest <= previous {
			return nil, outputAccessCorruption()
		}
		previous = digest
		entries = append(entries, map[string]any{"input_digest": "sha256:" + o.InputDigest.String(), "lease_epoch": o.LeaseEpoch, "restore_generation": o.RestoreGeneration, "artifact": map[string]any{"sha256": digest, "media_type": o.Artifact.MediaType, "byte_length": o.Artifact.ByteLength, "availability": "Present", "href": "/api/v1/projects/" + string(project) + "/artifacts/" + digest, "disposition": "attachment"}})
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	data, err := json.Marshal(map[string]any{"project_id": project, "work_item_id": item, "run_id": run, "outputs": entries}, json.Deterministic(true))
	if len(data) > 1<<20 {
		return nil, outputAccessCorruption()
	}
	return data, err
}

// ReadOutputArtifact verifies bounded bytes outside the metadata transaction and
// then verifies exactly the selected immutable association again.
func (s *Service) ReadOutputArtifact(ctx context.Context, actor domain.ActorID, project domain.ProjectID, digest domain.Digest) ([]byte, error) {
	if actor == "" || actor != s.config.Operator || project == "" || digest.IsZero() {
		return nil, port.ErrNotFound
	}
	var before port.RunOutput
	err := s.unit.Within(ctx, func(tx port.Transaction) error {
		reader, err := outputAccessReader(tx)
		if err != nil {
			return err
		}
		before, err = reader.LoadProjectRunOutput(ctx, project, digest)
		return err
	})
	if err != nil {
		return nil, err
	}
	if !validOutputMetadata(before, project, before.RunID) || before.ArtifactDigest != digest {
		return nil, outputAccessCorruption()
	}
	if !outputDownloadMediaAllowed(before.Artifact.MediaType) {
		return nil, port.ErrRunLifecycle
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if nilRepositoryDependency(s.artifacts) {
		return nil, outputAccessUnavailable()
	}
	reader, err := s.artifacts.Open(ctx, digest)
	if err != nil || nilRepositoryDependency(reader) {
		if !nilRepositoryDependency(reader) {
			_ = reader.Close()
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return nil, outputAccessUnavailable()
	}
	content, readErr := io.ReadAll(io.LimitReader(reader, maxRunArtifactBytes+1))
	closeErr := reader.Close()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if readErr != nil || closeErr != nil || uint64(len(content)) != before.Artifact.ByteLength || len(content) > maxRunArtifactBytes || domain.HashBytes(content) != digest {
		return nil, outputAccessCorruption()
	}
	err = s.unit.Within(ctx, func(tx port.Transaction) error {
		reader, err := outputAccessReader(tx)
		if err != nil {
			return err
		}
		outputs, err := reader.LoadRunOutputs(ctx, project, before.RunID)
		if err != nil {
			if errors.Is(err, port.ErrNotFound) {
				return outputAccessCorruption()
			}
			return err
		}
		if len(outputs) > port.RunOutputLimit {
			return outputAccessCorruption()
		}
		previous := ""
		found := false
		for _, o := range outputs {
			if !validOutputMetadata(o, project, before.RunID) || o.ArtifactDigest.String() <= previous {
				return outputAccessCorruption()
			}
			previous = o.ArtifactDigest.String()
			if o.ArtifactDigest == digest {
				if o != before {
					return outputAccessCorruption()
				}
				found = true
			}
		}
		if !found {
			return outputAccessCorruption()
		}
		return nil
	})
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return content, nil
}
