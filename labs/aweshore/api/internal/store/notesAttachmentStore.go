package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
)

// NotesAttachmentStore interface defines the operations for note-attachment relationships
type NotesAttachmentStore interface {
	Create(noteID int64, attachmentID int64) error
	Delete(noteID int64, attachmentID int64) error
	GetAttachmentsByNoteID(noteID int64) ([]model.Attachment, error)
	GetNotesByAttachmentID(attachmentID int64) ([]model.Note, error)
}

type notesAttachmentStore struct {
	db *sql.DB
}

// NewNotesAttachmentStore creates a new instance of notesAttachmentStore
func NewNotesAttachmentStore() NotesAttachmentStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new NotesAttachmentStore.")
	}
	return &notesAttachmentStore{
		db: db.DB,
	}
}

// Create creates a relationship between a note and an attachment
func (s *notesAttachmentStore) Create(noteID int64, attachmentID int64) error {
	_, err := s.db.Exec("INSERT INTO notes_attachments (note_id, attachment_id) VALUES (?, ?)", noteID, attachmentID)
	return err
}

// Delete removes a relationship between a note and an attachment
func (s *notesAttachmentStore) Delete(noteID int64, attachmentID int64) error {
	_, err := s.db.Exec("DELETE FROM notes_attachments WHERE note_id = ? AND attachment_id = ?", noteID, attachmentID)
	return err
}

// GetAttachmentsByNoteID retrieves all attachments for a given note
func (s *notesAttachmentStore) GetAttachmentsByNoteID(noteID int64) ([]model.Attachment, error) {
	rows, err := s.db.Query("SELECT a.id, a.title, a.file_link, a.created, a.updated, a.status FROM attachments a INNER JOIN notes_attachments na ON a.id = na.attachment_id WHERE na.note_id = ?", noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var attachments []model.Attachment
	for rows.Next() {
		var a model.Attachment
		if err := rows.Scan(&a.ID, &a.Title, &a.FileLink, &a.Created, &a.Updated, &a.Status); err != nil {
			return nil, err
		}
		attachments = append(attachments, a)
	}
	return attachments, nil
}

// GetNotesByAttachmentID retrieves all notes that an attachment is related to
func (s *notesAttachmentStore) GetNotesByAttachmentID(attachmentID int64) ([]model.Note, error) {
	rows, err := s.db.Query("SELECT n.id, n.title, n.content, n.note_type_id, n.created, n.updated, n.status FROM notes n INNER JOIN notes_attachments na ON n.id = na.note_id WHERE na.attachment_id = ?", attachmentID)
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
