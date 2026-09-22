package reconcile

import (
	"bytes"
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type ReuseFingerprintConfig struct {
	CandidateDigest           domain.Digest
	RunInputDigest            domain.Digest
	RequiredACRevisions       []domain.ACRevisionBinding
	GraphRevisionDigest       domain.Digest
	PolicyRevisionDigest      domain.Digest
	VerificationRecipeDigest  domain.Digest
	EnvironmentDigest         domain.Digest
	IntegrationBaseApplicable bool
	IntegrationBaseDigest     domain.Digest
	AdapterID                 string
	AdapterVersion            string
	VerifierClass             string
}

type ReuseFingerprint struct {
	candidateDigest           domain.Digest
	runInputDigest            domain.Digest
	requiredACRevisions       []domain.ACRevisionBinding
	graphRevisionDigest       domain.Digest
	policyRevisionDigest      domain.Digest
	verificationRecipeDigest  domain.Digest
	environmentDigest         domain.Digest
	integrationBaseApplicable bool
	integrationBaseDigest     domain.Digest
	adapterID                 string
	adapterVersion            string
	verifierClass             string
	digest                    domain.Digest
	complete                  bool
}

func NewReuseFingerprint(config ReuseFingerprintConfig) ReuseFingerprint {
	revisions := slices.Clone(config.RequiredACRevisions)
	slices.SortFunc(revisions, func(left, right domain.ACRevisionBinding) int {
		return strings.Compare(string(left.ACID), string(right.ACID))
	})
	complete := !config.CandidateDigest.IsZero() && !config.RunInputDigest.IsZero() && len(revisions) > 0 &&
		!config.GraphRevisionDigest.IsZero() && !config.PolicyRevisionDigest.IsZero() &&
		!config.VerificationRecipeDigest.IsZero() && !config.EnvironmentDigest.IsZero() &&
		config.AdapterID != "" && config.AdapterVersion != "" && config.VerifierClass != "" &&
		(!config.IntegrationBaseApplicable || !config.IntegrationBaseDigest.IsZero())
	for index, revision := range revisions {
		if revision.ACID == "" || revision.RevisionDigest.IsZero() ||
			(index > 0 && revisions[index-1].ACID == revision.ACID) {
			complete = false
		}
	}

	fingerprint := ReuseFingerprint{
		candidateDigest: config.CandidateDigest, runInputDigest: config.RunInputDigest,
		requiredACRevisions: revisions, graphRevisionDigest: config.GraphRevisionDigest,
		policyRevisionDigest:     config.PolicyRevisionDigest,
		verificationRecipeDigest: config.VerificationRecipeDigest, environmentDigest: config.EnvironmentDigest,
		integrationBaseApplicable: config.IntegrationBaseApplicable, integrationBaseDigest: config.IntegrationBaseDigest,
		adapterID: config.AdapterID, adapterVersion: config.AdapterVersion, verifierClass: config.VerifierClass,
		complete: complete,
	}
	fingerprint.digest = domain.HashBytes(fingerprint.canonicalIdentity())
	return fingerprint
}

func (fingerprint ReuseFingerprint) Complete() bool        { return fingerprint.complete }
func (fingerprint ReuseFingerprint) Digest() domain.Digest { return fingerprint.digest }
func (fingerprint ReuseFingerprint) RequiredACRevisions() []domain.ACRevisionBinding {
	return slices.Clone(fingerprint.requiredACRevisions)
}

func (fingerprint ReuseFingerprint) canonicalIdentity() []byte {
	var buffer bytes.Buffer
	writeDigest(&buffer, fingerprint.candidateDigest)
	writeDigest(&buffer, fingerprint.runInputDigest)
	writeUint64(&buffer, uint64(len(fingerprint.requiredACRevisions)))
	for _, revision := range fingerprint.requiredACRevisions {
		writeString(&buffer, string(revision.ACID))
		writeDigest(&buffer, revision.RevisionDigest)
	}
	writeDigest(&buffer, fingerprint.graphRevisionDigest)
	writeDigest(&buffer, fingerprint.policyRevisionDigest)
	writeDigest(&buffer, fingerprint.verificationRecipeDigest)
	writeDigest(&buffer, fingerprint.environmentDigest)
	if fingerprint.integrationBaseApplicable {
		writeUint64(&buffer, 1)
		writeDigest(&buffer, fingerprint.integrationBaseDigest)
	} else {
		writeUint64(&buffer, 0)
	}
	writeString(&buffer, fingerprint.adapterID)
	writeString(&buffer, fingerprint.adapterVersion)
	writeString(&buffer, fingerprint.verifierClass)
	return buffer.Bytes()
}

type ReuseDecision string

const (
	ReuseMatch    ReuseDecision = "Match"
	ReuseMismatch ReuseDecision = "Mismatch"
	ReuseUnknown  ReuseDecision = "Unknown"
)

func CompareReuse(existing, requested ReuseFingerprint) ReuseDecision {
	if !existing.complete || !requested.complete {
		return ReuseUnknown
	}
	if existing.digest == requested.digest {
		return ReuseMatch
	}
	return ReuseMismatch
}
