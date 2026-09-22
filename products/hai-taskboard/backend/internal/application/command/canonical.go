package command

import (
	json "encoding/json/v2"
	"errors"
	"regexp"
	"slices"
	"time"
	"unicode"
	"unicode/utf8"
	"uuid"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var ErrInvalidCommand = errors.New("invalid command")

var (
	projectIDPattern  = regexp.MustCompile(`^prj_[0-9A-HJKMNP-TV-Z]{10,26}$`)
	workItemIDPattern = regexp.MustCompile(`^wi_[0-9A-HJKMNP-TV-Z]{10,26}$`)
	commandIDPattern  = regexp.MustCompile(`^cmd_[0-9A-HJKMNP-TV-Z]{10,26}$`)
)

type canonicalMetadata struct {
	APIVersion      string    `json:"api_version"`
	Operation       Operation `json:"operation"`
	CommandID       string    `json:"command_id"`
	IdempotencyKey  string    `json:"idempotency_key"`
	ProjectID       string    `json:"project_id"`
	ExpectedVersion uint64    `json:"expected_version"`
	IssuedAt        string    `json:"issued_at"`
}

type canonicalACRevision struct {
	ACID           string `json:"ac_id"`
	RevisionDigest string `json:"ac_revision_digest"`
}

type canonicalCreateProject struct {
	canonicalMetadata
	Name           string `json:"name"`
	RepositoryRoot string `json:"repository_root"`
	ApprovedRef    string `json:"approved_ref"`
}

type canonicalCreateWorkItem struct {
	canonicalMetadata
	WorkItemID          string                `json:"work_item_id"`
	Title               string                `json:"title"`
	Goal                string                `json:"goal"`
	OwnerID             string                `json:"owner_id"`
	RequiredACRevisions []canonicalACRevision `json:"required_ac_revisions"`
}

type canonicalWorkItemCommand struct {
	canonicalMetadata
	WorkItemID string `json:"work_item_id"`
}

type canonicalDispatchRun struct {
	canonicalMetadata
	WorkItemID   string `json:"work_item_id"`
	AdapterID    string `json:"adapter_id"`
	ScenarioID   string `json:"scenario_id"`
	RetryOfRunID string `json:"retry_of_run_id,omitempty"`
}

type canonicalCompletionSubject struct {
	ProjectID                   string                `json:"project_id"`
	WorkItemID                  string                `json:"work_item_id"`
	WorkItemVersion             uint64                `json:"work_item_version"`
	CandidateID                 string                `json:"candidate_id"`
	CandidateDigest             string                `json:"candidate_digest"`
	RunID                       string                `json:"run_id"`
	RunInputDigest              string                `json:"run_input_digest"`
	RequiredACRevisions         []canonicalACRevision `json:"required_ac_revisions"`
	AcceptedGraphRevisionDigest string                `json:"accepted_graph_revision_digest"`
	PolicyRevisionDigest        string                `json:"policy_revision_digest"`
	CompletionRecipeDigest      string                `json:"completion_recipe_digest"`
	IntegrationBaseDigest       string                `json:"integration_base_digest,omitempty"`
}

type canonicalCompleteWorkItem struct {
	canonicalMetadata
	WorkItemID string                     `json:"work_item_id"`
	Subject    canonicalCompletionSubject `json:"completion_subject"`
}

func CanonicalCreateProject(value CreateProject) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, CreateProjectOperation, value.ProjectID)
	if err != nil || value.Metadata.ExpectedVersion != 0 || !projectIDPattern.MatchString(string(value.ProjectID)) ||
		!validText(value.Name, 160) || !validText(value.RepositoryRoot, 512) || !validText(value.ApprovedRef, 200) {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(canonicalCreateProject{
		APIVersion: metadata.APIVersion, Operation: metadata.Operation, CommandID: metadata.CommandID,
		IdempotencyKey: metadata.IdempotencyKey, ProjectID: metadata.ProjectID,
		ExpectedVersion: metadata.ExpectedVersion, IssuedAt: metadata.IssuedAt,
		Name: value.Name, RepositoryRoot: value.RepositoryRoot, ApprovedRef: value.ApprovedRef,
	})
}

func CanonicalCreateWorkItem(value CreateWorkItem) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, CreateWorkItemOperation, value.ProjectID)
	if err != nil || value.Metadata.ExpectedVersion != 0 || !workItemIDPattern.MatchString(string(value.WorkItemID)) ||
		!validText(value.Title, 240) || !validText(value.Goal, 8000) || !validText(string(value.OwnerID), 120) {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	revisions, err := canonicalizeRevisions(value.RequiredACRevisions)
	if err != nil {
		return nil, domain.Digest{}, err
	}
	return marshalCanonical(canonicalCreateWorkItem{
		APIVersion: metadata.APIVersion, Operation: metadata.Operation, CommandID: metadata.CommandID,
		IdempotencyKey: metadata.IdempotencyKey, ProjectID: metadata.ProjectID,
		ExpectedVersion: metadata.ExpectedVersion, IssuedAt: metadata.IssuedAt,
		WorkItemID: string(value.WorkItemID), Title: value.Title, Goal: value.Goal,
		OwnerID: string(value.OwnerID), RequiredACRevisions: revisions,
	})
}

func CanonicalMarkReady(value MarkReady) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, MarkReadyOperation, value.ProjectID)
	if err != nil || value.Metadata.ExpectedVersion == 0 || !workItemIDPattern.MatchString(string(value.WorkItemID)) {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(canonicalWorkItemCommand{
		APIVersion: metadata.APIVersion, Operation: metadata.Operation, CommandID: metadata.CommandID,
		IdempotencyKey: metadata.IdempotencyKey, ProjectID: metadata.ProjectID,
		ExpectedVersion: metadata.ExpectedVersion, IssuedAt: metadata.IssuedAt,
		WorkItemID: string(value.WorkItemID),
	})
}

func CanonicalDispatchRun(value DispatchRun) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, DispatchRunOperation, value.ProjectID)
	if err != nil || value.Metadata.ExpectedVersion == 0 || !workItemIDPattern.MatchString(string(value.WorkItemID)) ||
		!validText(value.AdapterID, 120) || !validText(value.ScenarioID, 120) ||
		(value.RetryOfRunID != "" && !validText(string(value.RetryOfRunID), 120)) {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(canonicalDispatchRun{
		APIVersion: metadata.APIVersion, Operation: metadata.Operation, CommandID: metadata.CommandID,
		IdempotencyKey: metadata.IdempotencyKey, ProjectID: metadata.ProjectID,
		ExpectedVersion: metadata.ExpectedVersion, IssuedAt: metadata.IssuedAt,
		WorkItemID: string(value.WorkItemID), AdapterID: value.AdapterID,
		ScenarioID: value.ScenarioID, RetryOfRunID: string(value.RetryOfRunID),
	})
}

func CanonicalCompleteWorkItem(value CompleteWorkItem) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, CompleteWorkItemOperation, value.ProjectID)
	if err != nil || value.Metadata.ExpectedVersion == 0 || !workItemIDPattern.MatchString(string(value.WorkItemID)) ||
		value.Subject.ProjectID() != value.ProjectID || value.Subject.WorkItemID() != value.WorkItemID {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(canonicalCompleteWorkItem{
		APIVersion: metadata.APIVersion, Operation: metadata.Operation, CommandID: metadata.CommandID,
		IdempotencyKey: metadata.IdempotencyKey, ProjectID: metadata.ProjectID,
		ExpectedVersion: metadata.ExpectedVersion, IssuedAt: metadata.IssuedAt,
		WorkItemID: string(value.WorkItemID), Subject: canonicalSubject(value.Subject),
	})
}

func canonicalizeMetadata(value Metadata, operation Operation, projectID domain.ProjectID) (canonicalMetadata, error) {
	if !commandIDPattern.MatchString(value.CommandID) || !validText(value.IdempotencyKey, 80) ||
		!validText(value.CorrelationID, 80) || value.IssuedAt.IsZero() || !projectIDPattern.MatchString(string(projectID)) {
		return canonicalMetadata{}, ErrInvalidCommand
	}
	if _, err := uuid.Parse(value.IdempotencyKey); err != nil {
		return canonicalMetadata{}, ErrInvalidCommand
	}
	return canonicalMetadata{
		APIVersion: "v1", Operation: operation, CommandID: value.CommandID,
		IdempotencyKey: value.IdempotencyKey, ProjectID: string(projectID),
		ExpectedVersion: value.ExpectedVersion, IssuedAt: normalizeTime(value.IssuedAt),
	}, nil
}

func canonicalizeRevisions(source []ACRevision) ([]canonicalACRevision, error) {
	if len(source) == 0 {
		return nil, ErrInvalidCommand
	}
	revisions := slices.Clone(source)
	slices.SortFunc(revisions, func(left, right ACRevision) int {
		if left.ACID < right.ACID {
			return -1
		}
		if left.ACID > right.ACID {
			return 1
		}
		return 0
	})
	result := make([]canonicalACRevision, len(revisions))
	for index, revision := range revisions {
		if !validText(string(revision.ACID), 80) || revision.RevisionDigest.IsZero() ||
			(index > 0 && revisions[index-1].ACID == revision.ACID) {
			return nil, ErrInvalidCommand
		}
		result[index] = canonicalACRevision{ACID: string(revision.ACID), RevisionDigest: revision.RevisionDigest.String()}
	}
	return result, nil
}

func canonicalSubject(subject domain.CompletionSubject) canonicalCompletionSubject {
	revisions := subject.RequiredACRevisions()
	canonical := make([]canonicalACRevision, len(revisions))
	for index, revision := range revisions {
		canonical[index] = canonicalACRevision{ACID: string(revision.ACID), RevisionDigest: revision.RevisionDigest.String()}
	}
	result := canonicalCompletionSubject{
		ProjectID: string(subject.ProjectID()), WorkItemID: string(subject.WorkItemID()), WorkItemVersion: subject.WorkItemVersion(),
		CandidateID: string(subject.CandidateID()), CandidateDigest: subject.CandidateDigest().String(), RunID: string(subject.RunID()),
		RunInputDigest: subject.RunInputDigest().String(), RequiredACRevisions: canonical,
		AcceptedGraphRevisionDigest: subject.GraphRevisionDigest().String(), PolicyRevisionDigest: subject.PolicyRevisionDigest().String(),
		CompletionRecipeDigest: subject.RecipeDigest().String(),
	}
	if !subject.IntegrationBaseDigest().IsZero() {
		result.IntegrationBaseDigest = subject.IntegrationBaseDigest().String()
	}
	return result
}

func marshalCanonical(value any) ([]byte, domain.Digest, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, domain.Digest{}, err
	}
	return encoded, domain.HashBytes(encoded), nil
}

func normalizeTime(value time.Time) string { return value.UTC().Format(time.RFC3339Nano) }

func validText(value string, maximum int) bool {
	if value == "" || len(value) > maximum || !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}
