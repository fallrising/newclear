package domain

import (
	"bytes"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"unicode"
	"unicode/utf8"
)

var ErrInvalidSubject = errors.New("invalid completion subject")

type ACRevisionBinding struct {
	ACID           ACID
	RevisionDigest Digest
}

type CompletionSubjectConfig struct {
	ProjectID                   ProjectID
	WorkItemID                  WorkItemID
	WorkItemVersion             uint64
	CandidateID                 CandidateID
	CandidateDigest             Digest
	RunID                       RunID
	RunInputDigest              Digest
	RequiredACRevisions         []ACRevisionBinding
	AcceptedGraphRevisionDigest Digest
	PolicyRevisionDigest        Digest
	CompletionRecipeDigest      Digest
	IntegrationBaseDigest       Digest
}

// CompletionSubject is immutable: construction validates and copies every
// field, while slice accessors return fresh copies.
type CompletionSubject struct {
	projectID                   ProjectID
	workItemID                  WorkItemID
	workItemVersion             uint64
	candidateID                 CandidateID
	candidateDigest             Digest
	runID                       RunID
	runInputDigest              Digest
	requiredACRevisions         []ACRevisionBinding
	acceptedGraphRevisionDigest Digest
	policyRevisionDigest        Digest
	completionRecipeDigest      Digest
	integrationBaseDigest       Digest
}

func NewCompletionSubject(config CompletionSubjectConfig) (CompletionSubject, error) {
	if !validStableID(string(config.ProjectID)) || !validStableID(string(config.WorkItemID)) || config.WorkItemVersion == 0 ||
		!validStableID(string(config.CandidateID)) || config.CandidateDigest.IsZero() || !validStableID(string(config.RunID)) ||
		config.RunInputDigest.IsZero() || len(config.RequiredACRevisions) == 0 ||
		config.AcceptedGraphRevisionDigest.IsZero() || config.PolicyRevisionDigest.IsZero() ||
		config.CompletionRecipeDigest.IsZero() {
		return CompletionSubject{}, ErrInvalidSubject
	}

	revisions := slices.Clone(config.RequiredACRevisions)
	slices.SortFunc(revisions, func(left, right ACRevisionBinding) int {
		return stringCompare(string(left.ACID), string(right.ACID))
	})
	for index, revision := range revisions {
		if !validStableID(string(revision.ACID)) || revision.RevisionDigest.IsZero() {
			return CompletionSubject{}, ErrInvalidSubject
		}
		if index > 0 && revisions[index-1].ACID == revision.ACID {
			return CompletionSubject{}, fmt.Errorf("%w: duplicate AC ID %q", ErrInvalidSubject, revision.ACID)
		}
	}

	return CompletionSubject{
		projectID:                   config.ProjectID,
		workItemID:                  config.WorkItemID,
		workItemVersion:             config.WorkItemVersion,
		candidateID:                 config.CandidateID,
		candidateDigest:             config.CandidateDigest,
		runID:                       config.RunID,
		runInputDigest:              config.RunInputDigest,
		requiredACRevisions:         revisions,
		acceptedGraphRevisionDigest: config.AcceptedGraphRevisionDigest,
		policyRevisionDigest:        config.PolicyRevisionDigest,
		completionRecipeDigest:      config.CompletionRecipeDigest,
		integrationBaseDigest:       config.IntegrationBaseDigest,
	}, nil
}

func (subject CompletionSubject) ProjectID() ProjectID     { return subject.projectID }
func (subject CompletionSubject) WorkItemID() WorkItemID   { return subject.workItemID }
func (subject CompletionSubject) WorkItemVersion() uint64  { return subject.workItemVersion }
func (subject CompletionSubject) CandidateID() CandidateID { return subject.candidateID }
func (subject CompletionSubject) CandidateDigest() Digest  { return subject.candidateDigest }
func (subject CompletionSubject) RunID() RunID             { return subject.runID }
func (subject CompletionSubject) RunInputDigest() Digest   { return subject.runInputDigest }
func (subject CompletionSubject) GraphRevisionDigest() Digest {
	return subject.acceptedGraphRevisionDigest
}
func (subject CompletionSubject) PolicyRevisionDigest() Digest {
	return subject.policyRevisionDigest
}
func (subject CompletionSubject) RecipeDigest() Digest { return subject.completionRecipeDigest }
func (subject CompletionSubject) IntegrationBaseDigest() Digest {
	return subject.integrationBaseDigest
}
func (subject CompletionSubject) RequiredACRevisions() []ACRevisionBinding {
	return slices.Clone(subject.requiredACRevisions)
}

func (subject CompletionSubject) Digest() Digest {
	return HashBytes(subject.CanonicalJSON())
}

// CanonicalJSON implements CompletionSubjectV1 directly so key order and
// whitespace are part of this package's explicit signing contract.
func (subject CompletionSubject) CanonicalJSON() []byte {
	var buffer bytes.Buffer
	buffer.WriteByte('{')
	writeJSONField(&buffer, "accepted_graph_revision_digest", subject.acceptedGraphRevisionDigest.String(), true)
	writeJSONField(&buffer, "candidate_digest", subject.candidateDigest.String(), false)
	writeJSONField(&buffer, "candidate_id", string(subject.candidateID), false)
	writeJSONField(&buffer, "completion_recipe_digest", subject.completionRecipeDigest.String(), false)
	if !subject.integrationBaseDigest.IsZero() {
		writeJSONField(&buffer, "integration_base_digest", subject.integrationBaseDigest.String(), false)
	}
	writeJSONField(&buffer, "policy_revision_digest", subject.policyRevisionDigest.String(), false)
	writeJSONField(&buffer, "project_id", string(subject.projectID), false)
	buffer.WriteString(",\"required_ac_revisions\":[")
	for index, revision := range subject.requiredACRevisions {
		if index > 0 {
			buffer.WriteByte(',')
		}
		buffer.WriteString("{\"ac_id\":")
		writeJSONString(&buffer, string(revision.ACID))
		buffer.WriteString(",\"ac_revision_digest\":")
		writeJSONString(&buffer, revision.RevisionDigest.String())
		buffer.WriteByte('}')
	}
	buffer.WriteByte(']')
	writeJSONField(&buffer, "run_id", string(subject.runID), false)
	writeJSONField(&buffer, "run_input_digest", subject.runInputDigest.String(), false)
	writeJSONField(&buffer, "work_item_id", string(subject.workItemID), false)
	buffer.WriteString(",\"work_item_version\":")
	buffer.WriteString(strconv.FormatUint(subject.workItemVersion, 10))
	buffer.WriteByte('}')
	return buffer.Bytes()
}

func writeJSONField(buffer *bytes.Buffer, key, value string, first bool) {
	if !first {
		buffer.WriteByte(',')
	}
	writeJSONString(buffer, key)
	buffer.WriteByte(':')
	writeJSONString(buffer, value)
}

func writeJSONString(buffer *bytes.Buffer, value string) {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic("validated UTF-8 string could not be encoded as JSON: " + err.Error())
	}
	buffer.Write(encoded)
}

func validStableID(value string) bool {
	if value == "" || !utf8.ValidString(value) {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

func stringCompare(left, right string) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}
