package sqlite

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func directoryStore(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "directory.db")
	s, err := migrationOpen(t.Context(), root, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, path
}
func directorySeed(t *testing.T, s *Store, n int) {
	t.Helper()
	if err := s.Within(t.Context(), func(tx port.Transaction) error {
		for i := range n {
			if err := tx.CreateProject(t.Context(), port.Project{ID: domain.ProjectID(fmt.Sprintf("prj_%010d", i)), Name: fmt.Sprintf("目標 %d", i), Repository: "display hint", Ref: "main", Version: 1}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
func TestProjectDirectory_ReadOnlyReopenAndScope(t *testing.T) {
	s, path := directoryStore(t)
	directorySeed(t, s, 2)
	before := migrationLogicalSnapshot(t, s.db)
	first, err := s.ReadProjects(t.Context())
	if err != nil || len(first.Projects) != 2 {
		t.Fatal(first, err)
	}
	if migrationLogicalSnapshot(t, s.db) != before {
		t.Fatal("read changed state")
	}
	if _, err := s.ReadProject(t.Context(), "prj_9999999999"); !errors.Is(err, port.ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := migrationOpen(t.Context(), filepath.Dir(path), path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	after, err := reopened.ReadProjects(t.Context())
	if err != nil || !reflect.DeepEqual(first, after) {
		t.Fatal(after, err)
	}
	one, err := reopened.ReadProject(t.Context(), first.Projects[0].ID)
	if err != nil || len(one.Projects) != 1 || one.Cursor != first.Cursor || one.Projects[0] != first.Projects[0] {
		t.Fatal(one, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := reopened.ReadProjects(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
func TestProjectDirectory_CapacityAndMalformedMetadata(t *testing.T) {
	t.Run("capacity", func(t *testing.T) {
		s, _ := directoryStore(t)
		directorySeed(t, s, port.ProjectDirectoryLimit)
		if got, err := s.ReadProjects(t.Context()); err != nil || len(got.Projects) != port.ProjectDirectoryLimit {
			t.Fatal(len(got.Projects), err)
		}
		migrationExec(t, s.db, `INSERT INTO projects VALUES('prj_9999999999','overflow','hint','main',1)`)
		if _, err := s.ReadProjects(t.Context()); !errors.Is(err, domain.ErrStorageCorruption) {
			t.Fatal(err)
		}
		if got, err := s.ReadProject(t.Context(), "prj_9999999999"); err != nil || len(got.Projects) != 1 {
			t.Fatal(got, err)
		}
	})
	for _, name := range []string{"oversized", "nul", "utf8_bytes", "id", "control"} {
		t.Run(name, func(t *testing.T) {
			s, _ := directoryStore(t)
			directorySeed(t, s, 1)
			value := strings.Repeat("a", 161)
			switch name {
			case "nul":
				value = "valid\x00" + strings.Repeat("a", 1000)
			case "utf8_bytes":
				value = strings.Repeat("界", 54)
			case "control":
				value = "bad\nname"
			}
			if name == "id" {
				migrationExec(t, s.db, `UPDATE projects SET project_id='malformed'`)
			} else {
				migrationExec(t, s.db, `UPDATE projects SET canonical_name=?`, value)
			}
			if _, err := s.ReadProjects(t.Context()); !errors.Is(err, domain.ErrStorageCorruption) {
				t.Fatal("malformed directory accepted", err)
			}
		})
	}
}
