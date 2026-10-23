package port

import (
	"context"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const ProjectDirectoryLimit = 1000

type ProjectDirectory struct {
	Projects []Project
	Cursor   Cursor
}

// ProjectDirectoryReader returns display metadata, never repository approval.
type ProjectDirectoryReader interface {
	ReadProjects(context.Context) (ProjectDirectory, error)
	ReadProject(context.Context, domain.ProjectID) (ProjectDirectory, error)
}
