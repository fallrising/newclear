package port

import "slices"

// ExecutorDeclaration is trusted configuration, not an executor observation.
type ExecutorDeclaration struct {
	AdapterID      string
	AdapterVersion string
	Capabilities   []string
}

func (declaration ExecutorDeclaration) Clone() ExecutorDeclaration {
	declaration.Capabilities = slices.Clone(declaration.Capabilities)
	return declaration
}

// Executor exposes only its declaration to the command service. Dispatch is
// performed by the later outbox worker, never in a command transaction.
type Executor interface {
	Declaration() ExecutorDeclaration
}
