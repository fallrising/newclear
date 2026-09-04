package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
)

// NotesTagStore interface defines the operations for note-tag relationships
type NotesTagStore interface {
	AssociateTagWithNote(noteID int64, tagID int64) error
	RemoveTagFromNote(noteID int64, tagID int64) error
	GetTagsByNoteID(noteID int64) ([]model.Tag, error)
	GetNotesByTagID(tagID int64) ([]model.Note, error)
}

type notesTagStore struct {
	db *sql.DB
}

// NewNotesTagStore creates a new instance of notesTagStore
func NewNotesTagStore() NotesTagStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new NotesTagStore.")
	}
	return &notesTagStore{
		db: db.DB,
	}
}

// AssociateTagWithNote creates a relationship between a note and a tag
func (s *notesTagStore) AssociateTagWithNote(noteID int64, tagID int64) error {
	_, err := s.db.Exec("INSERT INTO notes_tags (note_id, tag_id) VALUES (?, ?)", noteID, tagID)
	return err
}

// RemoveTagFromNote deletes a relationship between a note and a tag
func (s *notesTagStore) RemoveTagFromNote(noteID int64, tagID int64) error {
	_, err := s.db.Exec("DELETE FROM notes_tags WHERE note_id = ? AND tag_id = ?", noteID, tagID)
	return err
}

// GetTagsByNoteID retrieves all tags associated with a given note
func (s *notesTagStore) GetTagsByNoteID(noteID int64) ([]model.Tag, error) {
	rows, err := s.db.Query("SELECT t.id, t.tag_name, t.created, t.updated, t.status FROM tags t INNER JOIN notes_tags nt ON t.id = nt.tag_id WHERE nt.note_id = ?", noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []model.Tag
	for rows.Next() {
		var t model.Tag
		if err := rows.Scan(&t.ID, &t.TagName, &t.Created, &t.Updated, &t.Status); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, nil
}

// GetNotesByTagID retrieves all notes that have been tagged with a specific tag
func (s *notesTagStore) GetNotesByTagID(tagID int64) ([]model.Note, error) {
	rows, err := s.db.Query("SELECT n.id, n.title, n.content, n.note_type_id, n.created, n.updated, n.status FROM notes n INNER JOIN notes_tags nt ON n.id = nt.note_id WHERE nt.tag_id = ?", tagID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []model.Note
	for rows.Next() {
		var n model.Note
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.NoteTypeID, &n.Created, &n.Updated, &n.Status); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, nil
}
