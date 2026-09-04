package model

import "time"

// UserNote maps to the user_notes table
type UserNote struct {
	ID        int       `db:"id"`
	UserID    int       `db:"user_id"`
	NoteID    int       `db:"note_id"`
	CreatedAt time.Time `db:"created_at"`
}
