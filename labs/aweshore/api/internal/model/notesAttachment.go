package model

// NotesAttachment maps to the notes_attachments table
type NotesAttachment struct {
	NoteID       int `db:"note_id"`
	AttachmentID int `db:"attachment_id"`
}
