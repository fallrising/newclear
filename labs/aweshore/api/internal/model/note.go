package model

import (
	"time"
)

// Note maps to the notes table
type Note struct {
	ID         int       `db:"id"`
	Title      string    `db:"title"`
	Content    string    `db:"content"`
	NoteTypeID int       `db:"note_type_id"`
	Created    time.Time `db:"created"`
	Updated    time.Time `db:"updated"`
	Status     string    `db:"status"`
}
