package ui

import (
	"bytes"
	"encoding/json"
	"html/template"
	"io/fs"
	"net/http"
	"time"

	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/store"
)

// Pages is the server-rendered catalog.
type Pages struct {
	st   *store.Store
	now  func() time.Time
	tmpl *template.Template
	stat http.Handler
}

func New(st *store.Store) (*Pages, error) {
	t, err := template.ParseFS(templatesFS, "templates/*.html")
	if err != nil {
		return nil, err
	}
	subS, err := fs.Sub(staticFS, "static")
	if err != nil {
		return nil, err
	}
	return &Pages{
		st:   st,
		now:  func() time.Time { return time.Now().UTC() },
		tmpl: t,
		stat: http.StripPrefix("/static/", http.FileServer(http.FS(subS))),
	}, nil
}

func (p *Pages) Static() http.Handler { return p.stat }

type row struct {
	Name              string
	URL               string
	Node              string
	NodeStatus        string
	GitSHA            string
	Health            string
	ExposeMode        string
	DesiredState      string
	Generation        int64
	AppliedGeneration int64
	IngressStatus     string
}

func (p *Pages) Catalog(w http.ResponseWriter, r *http.Request) {
	list, err := p.st.ListServices()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	rows := make([]row, 0, len(list))
	for i := range list {
		rows = append(rows, p.rowOf(&list[i]))
	}
	p.render(w, "catalog", map[string]any{"Title": "Catalog", "Services": rows})
}

func (p *Pages) ServiceRow(w http.ResponseWriter, r *http.Request, name string) {
	svc, err := p.st.GetService(name)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	var buf bytes.Buffer
	if err := p.tmpl.ExecuteTemplate(&buf, "row", p.rowOf(svc)); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(buf.Bytes())
}

func (p *Pages) Node(w http.ResponseWriter, r *http.Request, id string) {
	n, err := p.st.GetNode(id)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	list, _ := p.st.ListServices()
	var rows []row
	for i := range list {
		if list[i].NodeID == id {
			rows = append(rows, p.rowOf(&list[i]))
		}
	}
	pretty, _ := json.MarshalIndent(json.RawMessage([]byte(n.FactsJSON)), "", "  ")
	p.render(w, "node", map[string]any{
		"Title": n.ID, "Node": n, "Status": n.Status(p.now()),
		"FactsPretty": string(pretty), "Services": rows,
	})
}

func (p *Pages) Service(w http.ResponseWriter, r *http.Request, name string) {
	svc, err := p.st.GetService(name)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	rels, _ := p.st.ListReleases(name)
	inst, _ := p.st.GetInstance(name)
	ib, _ := json.MarshalIndent(inst, "", "  ")
	aud, _ := p.st.ListAuditForService(name, 20)
	ab, _ := json.MarshalIndent(aud, "", "  ")
	p.render(w, "service", map[string]any{
		"Title": name, "View": p.rowOf(svc), "Releases": rels,
		"CurrentReleaseID": svc.CurrentReleaseID,
		"InstancePretty":   string(ib), "AuditPretty": string(ab),
	})
}

func (p *Pages) Login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = p.tmpl.ExecuteTemplate(w, "login", nil)
}

func (p *Pages) render(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := p.tmpl.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, err.Error(), 500)
	}
}

func (p *Pages) rowOf(svc *model.Service) row {
	r := row{
		Name: svc.Name, URL: svc.URL, Node: svc.NodeID, NodeStatus: "offline",
		Health: "unknown", ExposeMode: svc.ExposeMode, DesiredState: svc.DesiredState,
		Generation: svc.Generation, IngressStatus: svc.IngressStatus,
	}
	if n, err := p.st.GetNode(svc.NodeID); err == nil {
		r.NodeStatus = n.Status(p.now())
	}
	if inst, err := p.st.GetInstance(svc.Name); err == nil {
		r.Health = inst.Health
		r.AppliedGeneration = inst.AppliedGeneration
		if inst.ReportedAt != "" {
			if t, e := time.Parse(time.RFC3339, inst.ReportedAt); e == nil && p.now().Sub(t) > 90*time.Second {
				r.Health = "unknown"
			}
		}
		if svc.Generation != inst.AppliedGeneration {
			r.Health = "progressing"
		}
	}
	if r.NodeStatus != "online" {
		r.Health = "offline-node"
	}
	if svc.CurrentReleaseID != "" {
		if rel, err := p.st.GetRelease(svc.CurrentReleaseID); err == nil {
			r.GitSHA = rel.GitSHA
			if len(r.GitSHA) > 12 {
				r.GitSHA = r.GitSHA[:12]
			}
		}
	}
	return r
}
