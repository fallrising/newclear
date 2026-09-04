package model

import "time"

// Attachment maps to the attachments table
type Attachment struct {
	ID       int       `db:"id"`
	Title    string    `db:"title"`
	FileLink string    `db:"file_link"`
	Created  time.Time `db:"created"`
	Updated  time.Time `db:"updated"`
	Status   string    `db:"status"`
}
