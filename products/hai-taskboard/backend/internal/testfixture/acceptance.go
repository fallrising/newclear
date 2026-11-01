package testfixture

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	json "encoding/json/v2"
	"fmt"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

type snapshot struct {
	commit  specification.ObjectID
	objects map[specification.ObjectID]specification.Object
}

func (s *snapshot) Open(context.Context, string) (specification.Snapshot, error) { return s, nil }
func (s *snapshot) Commit() specification.ObjectID                               { return s.commit }
func (s *snapshot) Close() error                                                 { return nil }
func (s *snapshot) ReadObject(ctx context.Context, id specification.ObjectID, _ int64) (specification.Object, error) {
	return s.objects[id], ctx.Err()
}

// Accept installs authenticated proposal/accepted codec material through the real
// persistence ports. This is a storage fixture, not proof of service admission.
func Accept(ctx context.Context, u port.UnitOfWork, p domain.ProjectID, actor domain.ActorID, policy, recipe domain.Digest, ac domain.ACID, content []byte, items []domain.WorkItemID, now int64) error {
	s := &snapshot{objects: map[specification.ObjectID]specification.Object{}}
	add := func(kind specification.ObjectKind, b []byte) specification.ObjectID {
		sum := sha1.Sum(append(fmt.Appendf(nil, "%s %d\x00", kind, len(b)), b...))
		id, _ := specification.ParseObjectID(specification.SHA1, hex.EncodeToString(sum[:]))
		s.objects[id] = specification.Object{Kind: kind, Data: b}
		return id
	}
	mappings, _ := json.Marshal(items)
	raw := fmt.Appendf(nil, `{"schema_version":1,"nodes":[{"id":"SPEC-A","path":"a.md","required":true,"work_item_ids":%s,"required_ac_revisions":[{"ac_id":%q,"ac_revision_digest":%q}],"recipe_digest":%q}],"edges":[]}`, mappings, ac, domain.HashBytes(content).String(), recipe.String())
	source := add(specification.BlobObject, []byte("fixture source\n"))
	manifest := add(specification.BlobObject, raw)
	var tree []byte
	for _, e := range []struct {
		name string
		id   specification.ObjectID
	}{{"a.md", source}, {"manifest.json", manifest}} {
		b, _ := hex.DecodeString(e.id.String())
		tree = append(tree, []byte("100644 "+e.name+"\x00")...)
		tree = append(tree, b...)
	}
	tr := add(specification.TreeObject, tree)
	s.commit = add(specification.CommitObject, []byte("tree "+tr.String()+"\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n"))
	approved := port.ApprovedRepository{Binding: specification.RepositoryBinding{ProjectID: p, ID: "fixture-binding", Version: 1, ObjectFormat: specification.SHA1}, ConfigurationID: "fixture", ApprovedBy: actor, Refs: []string{"refs/heads/main"}, ManifestPaths: []string{"manifest.json"}, Reader: s}
	var err error
	_, approved.Binding.Digest, err = port.CanonicalRepositoryBinding(approved)
	if err != nil {
		return err
	}
	proposal, err := specification.Import(ctx, s, specification.Request{Binding: approved.Binding, Ref: "refs/heads/main", ManifestPath: "manifest.json"})
	if err != nil {
		return err
	}
	return u.Within(ctx, func(tx port.Transaction) error {
		state, err := tx.(port.InitialAcceptanceTransaction).LoadInitialAcceptanceState(ctx, p, items)
		if err != nil {
			return err
		}
		var versions []port.InitialWorkItemVersion
		for _, id := range items {
			item, err := tx.LoadWorkItem(ctx, p, id)
			if err != nil {
				return err
			}
			versions = append(versions, port.InitialWorkItemVersion{WorkItemID: id, ExpectedVersion: item.Version()})
		}
		record, err := port.BuildInitialAcceptedRecord(proposal, port.NewInitialAcceptanceSubject(p, state.Project.Version, proposal, policy, versions), actor)
		if err != nil {
			return err
		}
		a := tx.(port.InitialAcceptanceTransaction)
		if err := a.StoreProposal(ctx, approved, proposal, now); err != nil {
			return err
		}
		return a.StoreInitialAcceptance(ctx, record, []port.ACRevision{{ProjectID: p, ACID: ac, Digest: domain.HashBytes(content), Content: content}}, now)
	})
}
