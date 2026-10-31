package service

import (
	"maps"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// SpecificationPolicy derives readiness from trusted application policy and
// persisted accepted requirements. The MarkReady payload has no validity
// override.
type SpecificationPolicy interface {
	ValidFor(domain.ProjectID, domain.WorkItemID, []port.ACRequirement) bool
}

type VerificationRule struct {
	VerifierClass             string
	Independent               bool
	ProhibitedVerifierActor   domain.ActorID
	ProhibitedVerifierRunRole string
	EnvironmentDigest         domain.Digest
}

type CompletionPolicy struct {
	RevisionDigest        domain.Digest
	RecipeDigest          domain.Digest
	IntegrationBaseDigest domain.Digest
	ApprovalRequired      bool
	Checks                map[domain.ACID]VerificationRule
}

func (policy CompletionPolicy) clone() CompletionPolicy {
	policy.Checks = maps.Clone(policy.Checks)
	return policy
}

type Config struct {
	RepositoryAuthority port.RepositoryAuthority
	Operator            domain.ActorID
	IdempotencyTTL      time.Duration
	Specification       SpecificationPolicy
	Completion          CompletionPolicy
	ProjectPolicies     map[domain.ProjectID]port.PolicyProfile
}

// completionFor selects the whole immutable profile; missing ACs never fall back.
func (s *Service) completionFor(project domain.ProjectID) CompletionPolicy {
	profile, ok := s.config.ProjectPolicies[project]
	if !ok {
		return s.config.Completion
	}
	m := profile.Material()
	recipe, _ := domain.ParseDigest(m.RecipeDigest)
	policy := CompletionPolicy{RevisionDigest: profile.Digest(), RecipeDigest: recipe, ApprovalRequired: m.ApprovalRequired, Checks: make(map[domain.ACID]VerificationRule, len(m.Rules))}
	if m.IntegrationBase.Digest != nil {
		policy.IntegrationBaseDigest, _ = domain.ParseDigest(*m.IntegrationBase.Digest)
	}
	for _, r := range m.Rules {
		environment, _ := domain.ParseDigest(r.EnvironmentDigest)
		policy.Checks[r.ACID] = VerificationRule{VerifierClass: r.VerifierClass, Independent: r.Independent, ProhibitedVerifierActor: r.ProhibitedVerifierActor, ProhibitedVerifierRunRole: r.ProhibitedVerifierRunRole, EnvironmentDigest: environment}
	}
	return policy
}
