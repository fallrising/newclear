package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
	"time"
)

// NoteStore interface defines the CRUD operations
type NoteStore interface {
	Create(note model.Note) (int64, error)
	GetByID(id int64) (*model.Note, error)
	GetAll() ([]model.Note, error)
	Update(id int64, note model.Note) error
	Delete(id int64) error
	GetLastIdByOffset(offset int) (int64, error)
	GetPaginated(lastId int64, pageSize int) ([]model.Note, error)
	Count() (int, error)
}

type noteStore struct {
	db *sql.DB
}

func NewNoteStore() NoteStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new NoteStore.")
	}
	return &noteStore{
		db: db.DB,
	}
}

func (s *noteStore) Create(note model.Note) (int64, error) {
	statement, err := s.db.Prepare("INSERT INTO notes (title, content, created, updated) VALUES (?, ?, ?, ?)")
	if err != nil {
		return 0, err
	}
	defer statement.Close()

	result, err := statement.Exec(note.Title, note.Content, time.Now(), time.Now())
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *noteStore) GetByID(id int64) (*model.Note, error) {
	note := &model.Note{}
	err := s.db.QueryRow("SELECT id, title, content, created, updated FROM notes WHERE id = ?", id).Scan(&note.ID, &note.Title, &note.Content, &note.Created, &note.Updated)
	if err != nil {
		return nil, err
	}
	return note, nil
}

func (s *noteStore) Count() (int, error) {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM notes").Scan(&count)
	return count, err
}

// noteStore struct implementation
func (s *noteStore) GetLastIdByOffset(offset int) (int64, error) {
	var lastId int64
	err := s.db.QueryRow("SELECT id FROM notes ORDER BY id LIMIT 1 OFFSET ?", offset).Scan(&lastId)
	return lastId, err
}

func (s *noteStore) GetPaginated(lastId int64, pageSize int) ([]model.Note, error) {
	rows, err := s.db.Query("SELECT id, title, content, created, updated FROM notes WHERE id >= ? ORDER BY id LIMIT ?", lastId, pageSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []model.Note
	for rows.Next() {
		var note model.Note
		if err = rows.Scan(&note.ID, &note.Title, &note.Content, &note.Created, &note.Updated); err != nil {
			return nil, err
		}
		notes = append(notes, note)
	}
	return notes, nil
}

func (s *noteStore) GetAll() ([]model.Note, error) {
	rows, err := s.db.Query("SELECT id, title, content, created, updated FROM notes")
	if err != nil {
		return []model.Note{}, err
	}
	defer rows.Close()

	var notes []model.Note
	for rows.Next() {
		var n model.Note
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.Created, &n.Updated); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	if notes == nil {
		notes = []model.Note{}
	}
	return notes, nil
}

func (s *noteStore) Update(id int64, note model.Note) error {
	_, err := s.db.Exec("UPDATE notes SET title = ?, content = ?, updated = ? WHERE id = ?", note.Title, note.Content, time.Now(), id)
	return err
}

func (s *noteStore) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM notes WHERE id = ?", id)
	return err
}
