package composeclient

import (
	"context"
	"errors"
)

type Project string // "fleet-hello"

type UpOpts struct {
	ForceRecreate bool
	Pull          bool // if true, Pull is still invoked separately; Up does not implicit-pull
}

type DownOpts struct {
	PurgeVolumes bool // compose down -v
}

type PsInfo struct {
	Running     bool
	ContainerID string
	Image       string
	Names       []string
}

type ComposeClient interface {
	Login(ctx context.Context, registry, username, password string) error
	Pull(ctx context.Context, project Project, composeFile string) error
	Up(ctx context.Context, project Project, composeFile string, opts UpOpts) error
	Start(ctx context.Context, project Project, composeFile string) error
	Stop(ctx context.Context, project Project, composeFile string) error
	Down(ctx context.Context, project Project, composeFile string, opts DownOpts) error
	Ps(ctx context.Context, project Project, composeFile string) (PsInfo, error)
	UpSidecar(ctx context.Context) error
}

var ProtectedProjects = []Project{"fleet-agent", "fleet-control"}

var ErrProtectedProject = errors.New("protected_project")

func IsProtected(p Project) bool {
	for _, x := range ProtectedProjects {
		if p == x {
			return true
		}
	}
	return false
}

func guard(p Project) error {
	if IsProtected(p) {
		return ErrProtectedProject
	}
	return nil
}
