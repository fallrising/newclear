package service

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"maps"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// InitialAcceptanceDescription is a read-only snapshot, never a reservation.
// Public digests use the canonical sha256: wire spelling.
type InitialAcceptanceDescription struct {
	ProposalDigest          string                        `json:"proposal_digest"`
	PolicyRevisionDigest    string                        `json:"policy_revision_digest"`
	AcceptanceSubjectDigest string                        `json:"acceptance_subject_digest"`
	ExpectedVersion         uint64                        `json:"expected_version"`
	WorkItems               []port.InitialWorkItemVersion `json:"work_items"`
	ACRevisions             []InitialACDescription        `json:"ac_revisions"`
}
type InitialACDescription struct {
	ACID           domain.ACID `json:"ac_id"`
	RevisionDigest string      `json:"revision_digest"`
}

func (service *Service) DescribeInitialAcceptance(ctx context.Context, principal domain.ActorID, project domain.ProjectID, digest domain.Digest) ([]byte, error) {
	var result InitialAcceptanceDescription
	if principal != service.config.Operator || project == "" || digest.IsZero() {
		return nil, command.NewError(command.CodeNotFound, "initial acceptance is unavailable", false, nil, nil)
	}
	err := service.unit.Within(ctx, func(base port.Transaction) error {
		tx, ok := base.(port.InitialAcceptanceTransaction)
		if !ok {
			return errors.New("initial acceptance transaction unavailable")
		}
		p, err := tx.LoadProposal(ctx, project, digest)
		if err != nil {
			return err
		}
		if err = service.initialAuthority(project, p); err != nil {
			return err
		}
		set := map[domain.WorkItemID]bool{}
		for _, node := range p.Nodes() {
			for _, id := range node.Binding.WorkItemIDs {
				set[id] = true
			}
		}
		if len(set) == 0 || len(set) > 256 {
			return errors.New("invalid initial mapping")
		}
		ids := slices.Sorted(maps.Keys(set))
		state, err := tx.LoadInitialAcceptanceState(ctx, project, ids)
		if err != nil {
			return err
		}
		if state.Project.ID != project || len(state.Items) != len(ids) || len(state.ItemHeads) != len(ids) || len(state.RunHistory) != len(ids) {
			return domain.StorageCorruptionError{Reason: "initial snapshot scope or cardinality"}
		}
		if state.ProjectHead {
			return errors.New("project already accepted")
		}
		items := make([]port.InitialWorkItemVersion, len(ids))
		for i, id := range ids {
			item := state.Items[i]
			if item.ID() != id || item.ProjectID() != project {
				return domain.StorageCorruptionError{Reason: "initial snapshot item scope"}
			}
			if item.Phase() != domain.PhaseDraft || state.ItemHeads[i] || state.RunHistory[i] {
				return errors.New("initial snapshot requires headless Draft without Run history")
			}
			items[i] = port.InitialWorkItemVersion{WorkItemID: id, ExpectedVersion: item.Version()}
		}
		subject := port.NewInitialAcceptanceSubject(project, state.Project.Version, p, service.config.Completion.RevisionDigest, items)
		_, sd, err := port.CanonicalInitialAcceptanceSubject(subject)
		if err != nil {
			return err
		}
		record, err := port.BuildInitialAcceptedRecord(p, subject, principal)
		if err != nil {
			return err
		}
		material := record.Material()
		for _, binding := range material.Bindings {
			for _, node := range binding.Nodes {
				if node.Recipe != service.config.Completion.RecipeDigest.String() {
					return errors.New("unsupported recipe")
				}
			}
		}
		acs := make([]InitialACDescription, len(material.ACs))
		for i, ac := range material.ACs {
			rule, ok := service.config.Completion.Checks[ac.ACID]
			if !ok || rule.VerifierClass == "" {
				return errors.New("AC verification policy missing")
			}
			acs[i] = InitialACDescription{ACID: ac.ACID, RevisionDigest: "sha256:" + ac.Digest}
		}
		// Recheck approved configuration immediately before returning the snapshot.
		if err = service.initialAuthority(project, p); err != nil {
			return err
		}
		result = InitialAcceptanceDescription{ProposalDigest: "sha256:" + digest.String(), PolicyRevisionDigest: "sha256:" + subject.PolicyDigest, AcceptanceSubjectDigest: "sha256:" + sd.String(), ExpectedVersion: state.Project.Version, WorkItems: items, ACRevisions: acs}
		return ctx.Err()
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(result)
}
