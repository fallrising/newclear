// Package rehydrationcap contains the unforgeable values used at the durable
// Done rehydration boundary. Its nested internal path deliberately limits use
// to the domain subtree; domain/sqlite is the only adapter that constructs it.
package rehydrationcap

// Capability and CompletedLoad have no exported fields, so a caller cannot
// manufacture the authority or substitute raw persistence values.
type Capability struct{ nonce *token }

type CompletedLoad struct {
	nonce         *token
	workItemID    string
	projectID     string
	version       uint64
	blockers      []Blocker
	recordID      string
	subjectDigest string
}

type Blocker struct {
	ID     string
	Reason string
}

type token struct{}

// NewCompletedLoad is used by the SQLite adapter after it has verified the
// authoritative rows. The paired values are rejected if mixed with another
// load operation.
func NewCompletedLoad(
	workItemID string,
	projectID string,
	version uint64,
	blockers []Blocker,
	recordID string,
	subjectDigest string,
) (Capability, CompletedLoad) {
	nonce := new(token)
	return Capability{nonce: nonce}, CompletedLoad{
		nonce: nonce, workItemID: workItemID, projectID: projectID, version: version,
		blockers: append([]Blocker(nil), blockers...), recordID: recordID, subjectDigest: subjectDigest,
	}
}

func (capability Capability) Valid(load CompletedLoad) bool {
	return capability.nonce != nil && capability.nonce == load.nonce
}

func (load CompletedLoad) WorkItemID() string  { return load.workItemID }
func (load CompletedLoad) ProjectID() string   { return load.projectID }
func (load CompletedLoad) Version() uint64     { return load.version }
func (load CompletedLoad) Blockers() []Blocker { return append([]Blocker(nil), load.blockers...) }
func (load CompletedLoad) RecordID() string {
	return load.recordID
}
func (load CompletedLoad) SubjectDigest() string { return load.subjectDigest }
