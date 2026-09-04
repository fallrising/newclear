package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
)

// NoteTypeStore interface defines the CRUD operations for note types
type NoteTypeStore interface {
	Create(noteType model.NoteType) (int64, error)
	GetByID(id int64) (*model.NoteType, error)
	GetAll() ([]model.NoteType, error)
	Update(id int64, noteType model.NoteType) error
	Delete(id int64) error
}

type noteTypeStore struct {
	db *sql.DB
}

// NewNoteTypeStore creates a new instance of noteTypeStore
func NewNoteTypeStore() NoteTypeStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new NoteTypeStore.")
	}
	return &noteTypeStore{
		db: db.DB,
	}
}

// Create inserts a new note type into the database
func (s *noteTypeStore) Create(noteType model.NoteType) (int64, error) {
	statement, err := s.db.Prepare("INSERT INTO note_types (type_name, description, status) VALUES (?, ?, ?)")
	if err != nil {
		return 0, err
	}
	defer statement.Close()

	result, err := statement.Exec(noteType.TypeName, noteType.Description, noteType.Status)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

// GetByID retrieves a note type by its ID from the database
func (s *noteTypeStore) GetByID(id int64) (*model.NoteType, error) {
	noteType := &model.NoteType{}
	err := s.db.QueryRow("SELECT id, type_name, description, status FROM note_types WHERE id = ?", id).Scan(&noteType.ID, &noteType.TypeName, &noteType.Description, &noteType.Status)
	if err != nil {
		return nil, err
	}
	return noteType, nil
}

// GetAll retrieves all note types from the database
func (s *noteTypeStore) GetAll() ([]model.NoteType, error) {
	rows, err := s.db.Query("SELECT id, type_name, description, status FROM note_types")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var noteTypes []model.NoteType
	for rows.Next() {
		var nt model.NoteType
		if err := rows.Scan(&nt.ID, &nt.TypeName, &nt.Description, &nt.Status); err != nil {
			return nil, err
		}
		noteTypes = append(noteTypes, nt)
	}
	if noteTypes == nil {
		noteTypes = make([]model.NoteType, 0)
	}
	return noteTypes, nil
}

// Update modifies an existing note type's details in the database
func (s *noteTypeStore) Update(id int64, noteType model.NoteType) error {
	_, err := s.db.Exec("UPDATE note_types SET type_name = ?, description = ?, status = ? WHERE id = ?", noteType.TypeName, noteType.Description, noteType.Status, id)
	return err
}

// Delete removes a note type from the database
func (s *noteTypeStore) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM note_types WHERE id = ?", id)
	return err
}
