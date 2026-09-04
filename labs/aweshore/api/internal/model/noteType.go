package model

// NoteType maps to the note_types table
type NoteType struct {
	ID          int    `db:"id"`
	TypeName    string `db:"type_name"`
	Description string `db:"description"`
	Status      string `db:"status"`
}
