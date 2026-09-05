package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

type ProjectID string
type WorkItemID string
type RunID string
type CandidateID string
type ACID string
type ActorID string
type CheckID string
type BlockerID string
type CompletionRecordID string
type EvidenceID string
type ReviewID string
type ApprovalID string

// Digest is a copy-safe SHA-256 value. Its bytes are deliberately private so a
// digest stored in an immutable domain record cannot be changed through an alias.
type Digest struct {
	value [sha256.Size]byte
}

var ErrInvalidDigest = errors.New("invalid SHA-256 digest")

func HashBytes(value []byte) Digest {
	return Digest{value: sha256.Sum256(value)}
}

func HashString(value string) Digest {
	return HashBytes([]byte(value))
}

func ParseDigest(value string) (Digest, error) {
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size {
		return Digest{}, ErrInvalidDigest
	}

	var result [sha256.Size]byte
	copy(result[:], decoded)
	return Digest{value: result}, nil
}

func (digest Digest) String() string {
	return hex.EncodeToString(digest.value[:])
}

func (digest Digest) IsZero() bool {
	return digest == Digest{}
}
