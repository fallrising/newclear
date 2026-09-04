package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
	"time"
)

// VersionedNoteStore interface defines the CRUD operations for versioned notes
type VersionedNoteStore interface {
	Create(versionedNote model.VersionedNote) (int64, error)
	GetByID(id int64) (*model.VersionedNote, error)
	GetAll() ([]model.VersionedNote, error)
	Update(id int64, versionedNote model.VersionedNote) error
	Delete(id int64) error
}

type versionedNoteStore struct {
	db *sql.DB
}

// NewVersionedNoteStore creates a new instance of versionedNoteStore
func NewVersionedNoteStore() VersionedNoteStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new VersionedNoteStore.")
	}
	return &versionedNoteStore{
		db: db.DB,
	}
}

// Create inserts a new versioned note into the database
func (s *versionedNoteStore) Create(versionedNote model.VersionedNote) (int64, error) {
	statement, err := s.db.Prepare("INSERT INTO versioned_notes (title, content, note_type_id, note_id, created, updated, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return 0, err
	}
	defer statement.Close()

	result, err := statement.Exec(versionedNote.Title, versionedNote.Content, versionedNote.NoteTypeID, versionedNote.NoteID, time.Now(), time.Now(), versionedNote.Status)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

// GetByID retrieves a versioned note by its ID from the database
func (s *versionedNoteStore) GetByID(id int64) (*model.VersionedNote, error) {
	versionedNote := &model.VersionedNote{}
	err := s.db.QueryRow("SELECT id, title, content, note_type_id, note_id, created, updated, status FROM versioned_notes WHERE id = ?", id).Scan(&versionedNote.ID, &versionedNote.Title, &versionedNote.Content, &versionedNote.NoteTypeID, &versionedNote.NoteID, &versionedNote.Created, &versionedNote.Updated, &versionedNote.Status)
	if err != nil {
		return nil, err
	}
	return versionedNote, nil
}

// GetAll retrieves all versioned notes from the database
func (s *versionedNoteStore) GetAll() ([]model.VersionedNote, error) {
	rows, err := s.db.Query("SELECT id, title, content, note_type_id, note_id, created, updated, status FROM versioned_notes")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versionedNotes []model.VersionedNote
	for rows.Next() {
		var vn model.VersionedNote
		if err := rows.Scan(&vn.ID, &vn.Title, &vn.Content, &vn.NoteTypeID, &vn.NoteID, &vn.Created, &vn.Updated, &vn.Status); err != nil {
			return nil, err
		}
		versionedNotes = append(versionedNotes, vn)
	}
	if versionedNotes == nil {
		versionedNotes = make([]model.VersionedNote, 0)
	}
	return versionedNotes, nil
}

// Update modifies an existing versioned note's details in the database
func (s *versionedNoteStore) Update(id int64, versionedNote model.VersionedNote) error {
	_, err := s.db.Exec("UPDATE versioned_notes SET title = ?, content = ?, note_type_id = ?, note_id = ?, updated = ?, status = ? WHERE id = ?", versionedNote.Title, versionedNote.Content, versionedNote.NoteTypeID, versionedNote.NoteID, time.Now(), versionedNote.Status, id)
	return err
}

// Delete removes a versioned note from the database
func (s *versionedNoteStore) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM versioned_notes WHERE id = ?", id)
	return err
}
