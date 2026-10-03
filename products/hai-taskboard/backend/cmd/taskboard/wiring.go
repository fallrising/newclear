package main

import (
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

// Dependencies is the sole concrete adapter composition boundary. Environment,
// listener and lifecycle ownership remain with a later integration task.
type Dependencies struct {
	Store       *sqlite.Store
	Executor    *fake.Adapter
	Clock       port.Clock
	IDs         port.IDSource
	Artifacts   port.ArtifactStore
	Projections httpapi.ProjectionSource
	Authority   httpapi.SessionAuthority
	Application service.Config
	HTTP        httpapi.Config
}

type Runtime struct {
	Commands *service.Service
	Handler  *httpapi.Server
	Hub      *httpapi.Hub
}

func Compose(dependencies Dependencies) (Runtime, error) {
	if dependencies.Store == nil || dependencies.Executor == nil || dependencies.Clock == nil || dependencies.IDs == nil || dependencies.Artifacts == nil || dependencies.Projections == nil || dependencies.Authority == nil {
		return Runtime{}, errors.New("invalid taskboard composition dependencies")
	}
	hub := httpapi.NewHub()
	commands, err := service.New(
		dependencies.Store,
		dependencies.Clock,
		dependencies.IDs,
		dependencies.Executor,
		dependencies.Artifacts,
		hub,
		dependencies.Application,
	)
	if err != nil {
		return Runtime{}, err
	}
	handler, err := httpapi.NewServer(
		commands,
		httpapi.UnitCommandResults{Unit: dependencies.Store},
		dependencies.Projections,
		dependencies.Authority,
		hub,
		dependencies.HTTP,
	)
	if err != nil {
		return Runtime{}, err
	}
	return Runtime{Commands: commands, Handler: handler, Hub: hub}, nil
}
