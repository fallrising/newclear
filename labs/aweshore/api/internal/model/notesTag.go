package model

// NotesTag maps to the notes_tags table
type NotesTag struct {
	NoteID int `db:"note_id"`
	TagID  int `db:"tag_id"`
}
