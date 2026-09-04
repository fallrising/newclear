package model

import "time"

// VersionedNote maps to the versioned_notes table
type VersionedNote struct {
	ID         int       `db:"id"`
	Title      string    `db:"title"`
	Content    string    `db:"content"`
	NoteTypeID int       `db:"note_type_id"`
	NoteID     int       `db:"note_id"`
	Created    time.Time `db:"created"`
	Updated    time.Time `db:"updated"`
	Status     string    `db:"status"`
}
