package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
	"time"
)

// AttachmentStore interface defines the CRUD operations for attachments
type AttachmentStore interface {
	Create(attachment model.Attachment) (int64, error)
	GetByID(id int64) (*model.Attachment, error)
	GetAll() ([]model.Attachment, error)
	Update(id int64, attachment model.Attachment) error
	Delete(id int64) error
}

type attachmentStore struct {
	db *sql.DB
}

// NewAttachmentStore creates a new instance of attachmentStore
func NewAttachmentStore() AttachmentStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new AttachmentStore.")
	}
	return &attachmentStore{
		db: db.DB,
	}
}

// Create inserts a new attachment into the database
func (s *attachmentStore) Create(attachment model.Attachment) (int64, error) {
	statement, err := s.db.Prepare("INSERT INTO attachments (title, file_link, created, updated, status) VALUES (?, ?, ?, ?, ?)")
	if err != nil {
		return 0, err
	}
	defer statement.Close()

	result, err := statement.Exec(attachment.Title, attachment.FileLink, time.Now(), time.Now(), attachment.Status)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

// GetByID retrieves an attachment by its ID from the database
func (s *attachmentStore) GetByID(id int64) (*model.Attachment, error) {
	attachment := &model.Attachment{}
	err := s.db.QueryRow("SELECT id, title, file_link, created, updated, status FROM attachments WHERE id = ?", id).Scan(&attachment.ID, &attachment.Title, &attachment.FileLink, &attachment.Created, &attachment.Updated, &attachment.Status)
	if err != nil {
		return nil, err
	}
	return attachment, nil
}

// GetAll retrieves all attachments from the database
func (s *attachmentStore) GetAll() ([]model.Attachment, error) {
	rows, err := s.db.Query("SELECT id, title, file_link, created, updated, status FROM attachments")
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
	if attachments == nil {
		attachments = make([]model.Attachment, 0)
	}
	return attachments, nil
}

// Update modifies an existing attachment's details in the database
func (s *attachmentStore) Update(id int64, attachment model.Attachment) error {
	_, err := s.db.Exec("UPDATE attachments SET title = ?, file_link = ?, updated = ?, status = ? WHERE id = ?", attachment.Title, attachment.FileLink, time.Now(), attachment.Status, id)
	return err
}

// Delete removes an attachment from the database
func (s *attachmentStore) Delete(id int64) error {
	_, err := s.db.Exec("DELETE FROM attachments WHERE id = ?", id)
	return err
}
