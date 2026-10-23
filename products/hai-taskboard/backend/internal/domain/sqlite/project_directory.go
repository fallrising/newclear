package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var directoryProjectID = regexp.MustCompile(`^prj_[0-9A-HJKMNP-TV-Z]{10,26}$`)

func (store *Store) ReadProjects(ctx context.Context) (port.ProjectDirectory, error) {
	return store.readProjectDirectory(ctx, "")
}
func (store *Store) ReadProject(ctx context.Context, id domain.ProjectID) (port.ProjectDirectory, error) {
	if id == "" {
		return port.ProjectDirectory{}, port.ErrNotFound
	}
	return store.readProjectDirectory(ctx, id)
}
func directoryText(s string, max int) bool {
	if len(s) == 0 || len(s) > max || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func (store *Store) readProjectDirectory(ctx context.Context, id domain.ProjectID) (port.ProjectDirectory, error) {
	result := port.ProjectDirectory{Projects: []port.Project{}}
	corrupt := func(err error) error {
		return errors.Join(domain.StorageCorruptionError{Reason: "invalid project directory"}, err)
	}
	err := store.readProjection(ctx, func(conn *sql.Conn) error {
		if err := conn.QueryRowContext(ctx, "SELECT stream_epoch,next_event_sequence FROM instance_state WHERE id=1").Scan(&result.Cursor.Epoch, &result.Cursor.Sequence); err != nil {
			return corrupt(err)
		}
		if result.Cursor.Epoch == 0 {
			return corrupt(nil)
		}
		query := `SELECT CASE WHEN length(CAST(project_id AS BLOB)) BETWEEN 1 AND 30 THEN project_id END,CASE WHEN length(CAST(canonical_name AS BLOB)) BETWEEN 1 AND 160 THEN canonical_name END,CASE WHEN length(CAST(repository AS BLOB)) BETWEEN 1 AND 512 THEN repository END,CASE WHEN length(CAST(repository_ref AS BLOB)) BETWEEN 1 AND 200 THEN repository_ref END,version FROM projects`
		args := []any{}
		if id != "" {
			query += " WHERE project_id=?"
			args = append(args, id)
		}
		query += " ORDER BY project_id LIMIT ?"
		args = append(args, port.ProjectDirectoryLimit+1)
		rows, err := conn.QueryContext(ctx, query, args...)
		if err != nil {
			return normalizeError(err)
		}
		defer rows.Close()
		for rows.Next() {
			if len(result.Projects) == port.ProjectDirectoryLimit {
				return corrupt(errors.New("project directory capacity exceeded"))
			}
			var p port.Project
			if err := rows.Scan(&p.ID, &p.Name, &p.Repository, &p.Ref, &p.Version); err != nil {
				return corrupt(err)
			}
			if !directoryProjectID.MatchString(string(p.ID)) || !directoryText(p.Name, 160) || !directoryText(p.Repository, 512) || !directoryText(p.Ref, 200) || p.Version == 0 || p.Version >= 1<<63 {
				return corrupt(nil)
			}
			result.Projects = append(result.Projects, p)
		}
		if err := rows.Err(); err != nil {
			return normalizeError(err)
		}
		if id != "" && len(result.Projects) == 0 {
			return port.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return port.ProjectDirectory{}, errors.Join(err, ctx.Err())
	}
	return result, nil
}

var _ port.ProjectDirectoryReader = (*Store)(nil)
