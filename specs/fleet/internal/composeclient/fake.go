package composeclient

import (
	"context"
	"sync"
)

// Fake is an in-memory ComposeClient for tests. There is no Ls().
type Fake struct {
	mu       sync.Mutex
	Projects map[Project]PsInfo
	Downs    []Project
	Ups      []Project
	Stops    []Project
	Starts   []Project
	Pulls    []Project
	Logins   int
	Sidecars int
	Pulled   bool
}

func NewFake() *Fake {
	return &Fake{Projects: map[Project]PsInfo{}}
}

func (f *Fake) Login(context.Context, string, string, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Logins++
	return nil
}

func (f *Fake) Pull(_ context.Context, project Project, _ string) error {
	if err := guard(project); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Pulls = append(f.Pulls, project)
	f.Pulled = true
	return nil
}

func (f *Fake) Up(_ context.Context, project Project, _ string, _ UpOpts) error {
	if err := guard(project); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Ups = append(f.Ups, project)
	info := f.Projects[project]
	info.Running = true
	if info.ContainerID == "" {
		info.ContainerID = "ctr-" + string(project)
	}
	f.Projects[project] = info
	return nil
}

func (f *Fake) Start(_ context.Context, project Project, _ string) error {
	if err := guard(project); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Starts = append(f.Starts, project)
	info := f.Projects[project]
	info.Running = true
	f.Projects[project] = info
	return nil
}

func (f *Fake) Stop(_ context.Context, project Project, _ string) error {
	if err := guard(project); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Stops = append(f.Stops, project)
	info := f.Projects[project]
	info.Running = false
	f.Projects[project] = info
	return nil
}

func (f *Fake) Down(_ context.Context, project Project, _ string, _ DownOpts) error {
	if err := guard(project); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Downs = append(f.Downs, project)
	info := f.Projects[project]
	info.Running = false
	f.Projects[project] = info
	return nil
}

func (f *Fake) Ps(_ context.Context, project Project, _ string) (PsInfo, error) {
	if err := guard(project); err != nil {
		return PsInfo{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Projects[project], nil
}

func (f *Fake) UpSidecar(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Sidecars++
	info := f.Projects["fleet-agent"]
	// Recreate sidecar only; do not Down the agent project.
	f.Projects["fleet-agent"] = info
	return nil
}

func (f *Fake) Running(p Project) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Projects[p].Running
}
