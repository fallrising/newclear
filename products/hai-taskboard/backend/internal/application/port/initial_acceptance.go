package port

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

const InitialAcceptanceLimit = 16 << 20

type InitialWorkItemVersion struct {
	WorkItemID      domain.WorkItemID `json:"work_item_id"`
	ExpectedVersion uint64            `json:"expected_version"`
}
type InitialAcceptanceSubject struct {
	Schema          int                      `json:"schema_version"`
	Operation       string                   `json:"operation"`
	ProjectID       domain.ProjectID         `json:"project_id"`
	ExpectedVersion uint64                   `json:"expected_version"`
	Base            *string                  `json:"base_accepted_revision_digest"`
	ProposalDigest  string                   `json:"proposal_digest"`
	GraphDigest     string                   `json:"graph_revision_digest"`
	BindingID       string                   `json:"repository_binding_id"`
	BindingVersion  uint64                   `json:"binding_version"`
	BindingDigest   string                   `json:"binding_digest"`
	PolicyDigest    string                   `json:"policy_revision_digest"`
	WorkItems       []InitialWorkItemVersion `json:"work_items"`
}

func validInitialDigest(s string) bool {
	d, e := domain.ParseDigest(s)
	return e == nil && !d.IsZero() && d.String() == s
}
func CanonicalInitialAcceptanceSubject(v InitialAcceptanceSubject) ([]byte, domain.Digest, error) {
	v.WorkItems = slices.Clone(v.WorkItems)
	slices.SortFunc(v.WorkItems, func(a, b InitialWorkItemVersion) int {
		if a.WorkItemID < b.WorkItemID {
			return -1
		}
		if a.WorkItemID > b.WorkItemID {
			return 1
		}
		return 0
	})
	if v.Schema != 1 || v.Operation != "AcceptInitialSpecification" || v.ProjectID == "" || v.ExpectedVersion == 0 || v.ExpectedVersion >= 1<<63-1 || v.Base != nil || v.BindingID == "" || v.BindingVersion == 0 || v.BindingVersion > 1<<63-1 || len(v.WorkItems) == 0 || len(v.WorkItems) > 256 {
		return nil, domain.Digest{}, errors.New("invalid initial acceptance subject")
	}
	for _, d := range []string{v.ProposalDigest, v.GraphDigest, v.BindingDigest, v.PolicyDigest} {
		if !validInitialDigest(d) {
			return nil, domain.Digest{}, errors.New("invalid subject digest")
		}
	}
	for i, w := range v.WorkItems {
		if w.WorkItemID == "" || w.ExpectedVersion == 0 || w.ExpectedVersion >= 1<<63-1 || (i > 0 && v.WorkItems[i-1].WorkItemID == w.WorkItemID) {
			return nil, domain.Digest{}, errors.New("invalid initial read set")
		}
	}
	data, e := json.Marshal(v)
	return data, domain.HashBytes(data), e
}
func NewInitialAcceptanceSubject(project domain.ProjectID, version uint64, p specification.Proposal, policy domain.Digest, items []InitialWorkItemVersion) InitialAcceptanceSubject {
	b := p.Binding()
	return InitialAcceptanceSubject{Schema: 1, Operation: "AcceptInitialSpecification", ProjectID: project, ExpectedVersion: version, ProposalDigest: p.Digest().String(), GraphDigest: p.Graph().Revision().String(), BindingID: b.ID, BindingVersion: b.Version, BindingDigest: b.Digest.String(), PolicyDigest: policy.String(), WorkItems: slices.Clone(items)}
}

type InitialACBinding struct {
	ACID   domain.ACID `json:"ac_id"`
	Digest string      `json:"ac_revision_digest"`
}
type InitialNodeBinding struct {
	NodeID string             `json:"node_id"`
	ACs    []InitialACBinding `json:"required_ac_revisions"`
	Recipe string             `json:"recipe_digest"`
}
type InitialItemBinding struct {
	ProjectID  domain.ProjectID     `json:"project_id"`
	WorkItemID domain.WorkItemID    `json:"work_item_id"`
	Nodes      []InitialNodeBinding `json:"nodes"`
	ACs        []InitialACBinding   `json:"required_ac_revisions"`
}
type InitialAcceptedMaterial struct {
	Schema                 int                      `json:"schema_version"`
	Subject                InitialAcceptanceSubject `json:"acceptance_subject"`
	SubjectDigest          string                   `json:"acceptance_subject_digest"`
	NormativeGraph         jsontext.Value           `json:"normative_graph"`
	NormativeBindingDigest string                   `json:"normative_binding_digest"`
	Actor                  domain.ActorID           `json:"accepted_by_actor"`
	ACs                    []InitialACBinding       `json:"required_ac_revisions"`
	Bindings               []InitialItemBinding     `json:"work_item_bindings"`
}

// InitialAcceptedRecord owns canonical bytes; every exported view is a defensive copy.
type InitialAcceptedRecord struct {
	data   []byte
	digest domain.Digest
}

func (r InitialAcceptedRecord) CanonicalJSON() []byte { return bytes.Clone(r.data) }
func (r InitialAcceptedRecord) Digest() domain.Digest { return r.digest }
func (r InitialAcceptedRecord) Material() InitialAcceptedMaterial {
	var m InitialAcceptedMaterial
	_ = json.Unmarshal(r.data, &m)
	return m
}
func InitialBindingCanonical(v InitialItemBinding) ([]byte, domain.Digest, error) {
	b, e := json.Marshal(v)
	return b, domain.HashBytes(b), e
}

// BuildInitialAcceptedRecord derives every normative binding from the verified proposal.
func BuildInitialAcceptedRecord(p specification.Proposal, subject InitialAcceptanceSubject, actor domain.ActorID) (InitialAcceptedRecord, error) {
	sb, sd, e := CanonicalInitialAcceptanceSubject(subject)
	if e != nil || actor == "" {
		return InitialAcceptedRecord{}, errors.New("invalid initial record")
	}
	_ = json.Unmarshal(sb, &subject)
	expected := NewInitialAcceptanceSubject(subject.ProjectID, subject.ExpectedVersion, p, mustInitialDigest(subject.PolicyDigest), subject.WorkItems)
	eb, _, e := CanonicalInitialAcceptanceSubject(expected)
	if e != nil || !bytes.Equal(sb, eb) || p.Binding().ProjectID != subject.ProjectID {
		return InitialAcceptedRecord{}, errors.New("proposal subject mismatch")
	}
	acs := map[domain.ACID]string{}
	items := map[domain.WorkItemID]*InitialItemBinding{}
	for _, n := range p.Nodes() {
		nb := InitialNodeBinding{NodeID: string(n.ID), Recipe: n.Binding.RecipeDigest.String(), ACs: []InitialACBinding{}}
		for _, a := range n.Binding.RequiredACRevisions {
			d := a.RevisionDigest.String()
			if prev, ok := acs[a.ACID]; ok && prev != d {
				return InitialAcceptedRecord{}, errors.New("conflicting AC revisions")
			}
			acs[a.ACID] = d
			nb.ACs = append(nb.ACs, InitialACBinding{a.ACID, d})
		}
		slices.SortFunc(nb.ACs, func(a, b InitialACBinding) int {
			if a.ACID < b.ACID {
				return -1
			}
			if a.ACID > b.ACID {
				return 1
			}
			return 0
		})
		for _, id := range n.Binding.WorkItemIDs {
			it := items[id]
			if it == nil {
				it = &InitialItemBinding{ProjectID: subject.ProjectID, WorkItemID: id, Nodes: []InitialNodeBinding{}, ACs: []InitialACBinding{}}
				items[id] = it
			}
			it.Nodes = append(it.Nodes, nb)
		}
	}
	if len(acs) == 0 || len(acs) > 256 || len(items) != len(subject.WorkItems) {
		return InitialAcceptedRecord{}, errors.New("initial mapping capacity or coverage")
	}
	m := InitialAcceptedMaterial{Schema: 1, Subject: subject, SubjectDigest: sd.String(), NormativeGraph: p.NormativeJSON(), Actor: actor, ACs: []InitialACBinding{}, Bindings: []InitialItemBinding{}}
	ids := make([]domain.ACID, 0, len(acs))
	for id := range acs {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		m.ACs = append(m.ACs, InitialACBinding{id, acs[id]})
	}
	for _, w := range subject.WorkItems {
		it := items[w.WorkItemID]
		if it == nil {
			return InitialAcceptedRecord{}, errors.New("initial work item set mismatch")
		}
		slices.SortFunc(it.Nodes, func(a, b InitialNodeBinding) int {
			if a.NodeID < b.NodeID {
				return -1
			}
			if a.NodeID > b.NodeID {
				return 1
			}
			return 0
		})
		req := map[domain.ACID]string{}
		for _, n := range it.Nodes {
			for _, a := range n.ACs {
				req[a.ACID] = a.Digest
			}
		}
		for _, a := range m.ACs {
			if _, ok := req[a.ACID]; ok {
				it.ACs = append(it.ACs, a)
			}
		}
		if len(it.ACs) == 0 {
			return InitialAcceptedRecord{}, errors.New("empty item requirements")
		}
		m.Bindings = append(m.Bindings, *it)
	}
	nb, e := json.Marshal(m.Bindings)
	if e != nil {
		return InitialAcceptedRecord{}, e
	}
	m.NormativeBindingDigest = domain.HashBytes(nb).String()
	data, e := json.Marshal(m)
	if e != nil || len(data) > InitialAcceptanceLimit {
		return InitialAcceptedRecord{}, errors.New("initial material capacity")
	}
	return InitialAcceptedRecord{data, domain.HashBytes(data)}, nil
}
func mustInitialDigest(s string) domain.Digest { d, _ := domain.ParseDigest(s); return d }
func DecodeInitialAcceptedRecord(data []byte, digest domain.Digest, p specification.Proposal) (InitialAcceptedRecord, error) {
	fail := func() (InitialAcceptedRecord, error) {
		return InitialAcceptedRecord{}, domain.StorageCorruptionError{Reason: "initial accepted canonical mismatch"}
	}
	if len(data) == 0 || len(data) > InitialAcceptanceLimit || domain.HashBytes(data) != digest {
		return fail()
	}
	var m InitialAcceptedMaterial
	if json.Unmarshal(data, &m, json.RejectUnknownMembers(true)) != nil {
		return fail()
	}
	r, e := BuildInitialAcceptedRecord(p, m.Subject, m.Actor)
	if e != nil || !bytes.Equal(data, r.data) {
		return fail()
	}
	return r, nil
}

type InitialAcceptanceState struct {
	Project     Project
	ProjectHead bool
	Items       []domain.WorkItem
	ItemHeads   []bool
	RunHistory  []bool
}
type InitialAcceptanceTransaction interface {
	AdmissionTransaction
	LoadInitialAcceptanceState(context.Context, domain.ProjectID, []domain.WorkItemID) (InitialAcceptanceState, error)
	StoreInitialAcceptance(context.Context, InitialAcceptedRecord, []ACRevision, int64) error
	LoadInitialAcceptance(context.Context, domain.ProjectID, domain.Digest) (InitialAcceptedRecord, error)
}
