package model

import "time"

// Tag maps to the tags table
type Tag struct {
	ID      int       `db:"id"`
	TagName string    `db:"tag_name"`
	Created time.Time `db:"created"`
	Updated time.Time `db:"updated"`
	Status  string    `db:"status"`
}
