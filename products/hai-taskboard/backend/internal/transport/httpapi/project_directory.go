package httpapi

import (
	"context"
	json "encoding/json/v2"
	"net/http"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type projectDirectorySource interface {
	Projects(context.Context) (port.ProjectDirectory, error)
	Project(context.Context, domain.ProjectID) (port.ProjectDirectory, error)
}

func (source PersistedProjections) Projects(ctx context.Context) (port.ProjectDirectory, error) {
	reader, ok := source.Store.(port.ProjectDirectoryReader)
	if !ok {
		return port.ProjectDirectory{}, ErrProjectionNotFound
	}
	return reader.ReadProjects(ctx)
}
func (source PersistedProjections) Project(ctx context.Context, id domain.ProjectID) (port.ProjectDirectory, error) {
	reader, ok := source.Store.(port.ProjectDirectoryReader)
	if !ok {
		return port.ProjectDirectory{}, ErrProjectionNotFound
	}
	return reader.ReadProject(ctx, id)
}

type directoryProject struct {
	ID         domain.ProjectID `json:"project_id"`
	Name       string           `json:"name"`
	Version    uint64           `json:"version"`
	Repository struct {
		BindingID   *string `json:"binding_id"`
		RootHint    string  `json:"root_hint"`
		ApprovedRef string  `json:"approved_ref"`
	} `json:"repository"`
	Cursor projectionCursor `json:"cursor"`
}

func directoryWire(p port.Project, cursor port.Cursor) (directoryProject, bool) {
	if !projectPattern.MatchString(string(p.ID)) || !validWireText(p.Name, 1, 160) || !validWireText(p.Repository, 1, 512) || !validWireText(p.Ref, 1, 200) || p.Version == 0 || p.Version >= 1<<63 || cursor.Epoch == 0 {
		return directoryProject{}, false
	}
	w := directoryProject{ID: p.ID, Name: p.Name, Version: p.Version, Cursor: projectionCursor{StreamEpoch: cursor.Epoch, EventSequence: cursor.Sequence}}
	w.Repository.RootHint = p.Repository
	w.Repository.ApprovedRef = p.Ref
	return w, true
}
func (server *Server) getProjects(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok {
		return
	}
	source, ok := server.projections.(projectDirectorySource)
	if !ok {
		writeAPIError(response, 503, command.CodeStorageCorruption, "project directory is unavailable")
		return
	}
	result, err := source.Projects(request.Context())
	if err != nil || result.Cursor.Epoch == 0 || len(result.Projects) > port.ProjectDirectoryLimit {
		writeAPIError(response, 503, command.CodeStorageCorruption, "project directory is unavailable")
		return
	}
	items := []directoryProject{}
	previous := ""
	for _, p := range result.Projects {
		w, valid := directoryWire(p, result.Cursor)
		if !valid || string(p.ID) <= previous {
			writeAPIError(response, 503, command.CodeStorageCorruption, "project directory is unavailable")
			return
		}
		previous = string(p.ID)
		if server.authority.AuthorizeProject(request.Context(), session, p.ID) == nil {
			items = append(items, w)
		}
	}
	body, err := json.Marshal(struct {
		APIVersion string             `json:"api_version"`
		Items      []directoryProject `json:"items"`
		Cursor     projectionCursor   `json:"cursor"`
	}{"v1", items, projectionCursor{StreamEpoch: result.Cursor.Epoch, EventSequence: result.Cursor.Sequence}})
	if err != nil {
		writeAPIError(response, 503, command.CodeStorageCorruption, "project directory is unavailable")
		return
	}
	writeJSONBytes(response, 200, body)
}
func (server *Server) getProject(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok {
		return
	}
	id, ok := pathProject(response, request)
	if !ok || !server.authorizeProject(response, request, session, id) {
		return
	}
	source, ok := server.projections.(projectDirectorySource)
	if !ok {
		server.notFound(response, request)
		return
	}
	result, err := source.Project(request.Context(), id)
	if err != nil || len(result.Projects) != 1 || result.Projects[0].ID != id {
		server.notFound(response, request)
		return
	}
	w, ok := directoryWire(result.Projects[0], result.Cursor)
	if !ok {
		server.notFound(response, request)
		return
	}
	body, err := json.Marshal(w)
	if err != nil {
		server.notFound(response, request)
		return
	}
	writeJSONBytes(response, 200, body)
}
