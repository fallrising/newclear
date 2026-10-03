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
	Operator       domain.ActorID
	IdempotencyTTL time.Duration
	Specification  SpecificationPolicy
	Completion     CompletionPolicy
}
