package model

import "time"

// User maps to the users table
type User struct {
	ID       int       `db:"id"`
	Username string    `db:"username"`
	Email    string    `db:"email"`
	Password string    `db:"password"`
	Created  time.Time `db:"created"`
	Updated  time.Time `db:"updated"`
	Status   string    `db:"status"`
}
