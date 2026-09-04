package store

import (
	"aweshore/internal/model"
	"aweshore/pkg/db"
	"database/sql"
)

// UserNotesStore interface defines the operations for user-note relationships
type UserNotesStore interface {
	LinkUserToNote(userID int64, noteID int64) error
	UnlinkUserFromNote(userID int64, noteID int64) error
	GetNotesByUserID(userID int64) ([]model.Note, error)
	GetUsersByNoteID(noteID int64) ([]model.User, error)
}

type userNotesStore struct {
	db *sql.DB
}

// NewUserNotesStore creates a new instance of userNotesStore
func NewUserNotesStore() UserNotesStore {
	if db.DB == nil {
		panic("db.DB is nil. Ensure db.Init() has been called before creating a new UserNotesStore.")
	}
	return &userNotesStore{
		db: db.DB,
	}
}

// LinkUserToNote associates a note with a user
func (s *userNotesStore) LinkUserToNote(userID int64, noteID int64) error {
	_, err := s.db.Exec("INSERT INTO user_notes (user_id, note_id) VALUES (?, ?)", userID, noteID)
	return err
}

// UnlinkUserFromNote removes the association between a note and a user
func (s *userNotesStore) UnlinkUserFromNote(userID int64, noteID int64) error {
	_, err := s.db.Exec("DELETE FROM user_notes WHERE user_id = ? AND note_id = ?", userID, noteID)
	return err
}

// GetNotesByUserID retrieves all notes associated with a given user
func (s *userNotesStore) GetNotesByUserID(userID int64) ([]model.Note, error) {
	rows, err := s.db.Query("SELECT n.id, n.title, n.content, n.note_type_id, n.created, n.updated, n.status FROM notes n INNER JOIN user_notes un ON n.id = un.note_id WHERE un.user_id = ?", userID)
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

// GetUsersByNoteID retrieves all users associated with a given note
func (s *userNotesStore) GetUsersByNoteID(noteID int64) ([]model.User, error) {
	rows, err := s.db.Query("SELECT u.id, u.username, u.email, u.password, u.created, u.updated, u.status FROM users u INNER JOIN user_notes un ON u.id = un.user_id WHERE un.note_id = ?", noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.Password, &u.Created, &u.Updated, &u.Status); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}
