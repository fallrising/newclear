// File: pkg/db/db.go
package db

import (
	"database/sql"
	_ "github.com/mattn/go-sqlite3" // Import go-sqlite3 library
	log "github.com/sirupsen/logrus"
)

var DB *sql.DB

func Init() {
	var err error
	DB, err = sql.Open("sqlite3", "aweshore.db")
	if err != nil {
		log.WithError(err).Fatal("An error occurred")
	}
	createTables()
	ensureDefaultNoteTypeExists()
}

func createTables() {
	createUsersTableSQL := `CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       username TEXT NOT NULL,
       email TEXT NOT NULL,
       password TEXT NOT NULL,
       created DATETIME NOT NULL,
       updated DATETIME NOT NULL,
       status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))
    );`

	createNotesTableSQL := `CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT,
		content TEXT,
		note_type_id INTEGER DEFAULT 1,
		created DATETIME NOT NULL,
		updated DATETIME NOT NULL,
		status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))
    );`

	createAttachmentsTableSQL := `CREATE TABLE IF NOT EXISTS attachments (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       title TEXT,
       file_link TEXT,
       created DATETIME NOT NULL,
       updated DATETIME NOT NULL,
       status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))
    );`

	createTagsTableSQL := `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_name TEXT NOT NULL,
    created DATETIME NOT NULL,
    updated DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))   
);`

	createNoteTypesTableSQL := `CREATE TABLE IF NOT EXISTS note_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_name TEXT NOT NULL,
    description TEXT, 
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))  
);`

	createVersionedNotesTableSQL := `CREATE TABLE IF NOT EXISTS versioned_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    note_type_id INTEGER,
    note_id INTEGER NOT NULL, 
    created DATETIME NOT NULL,
    updated DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted'))
);`

	createNotesAttachmentsTableSQL := `CREATE TABLE IF NOT EXISTS notes_attachments (
       note_id INTEGER NOT NULL,
       attachment_id INTEGER NOT NULL,
       PRIMARY KEY (note_id, attachment_id)
    );`

	createNotesTagsTableSQL := `CREATE TABLE IF NOT EXISTS notes_tags (
       note_id INTEGER NOT NULL,
       tag_id INTEGER NOT NULL,
       PRIMARY KEY (note_id, tag_id)
    );`

	createUserNotesTableSQL := `CREATE TABLE IF NOT EXISTS user_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        note_id INTEGER NOT NULL,
        created_at DATETIME NOT NULL
    );`

	// Execute table creation
	for _, createTableSQL := range []string{
		createUsersTableSQL,
		createNotesTableSQL,
		createAttachmentsTableSQL,
		createTagsTableSQL,
		createNoteTypesTableSQL,
		createVersionedNotesTableSQL,
		createNotesAttachmentsTableSQL,
		createNotesTagsTableSQL,
		createUserNotesTableSQL,
	} {
		statement, err := DB.Prepare(createTableSQL)
		if err != nil {
			log.WithError(err).Fatal("An error occurred")
		}
		statement.Exec()
	}
}

func ensureDefaultNoteTypeExists() {
	const defaultNoteTypeSQL = `INSERT INTO note_types (type_name, description, status)
                                SELECT * FROM (SELECT 'note', 'Default note type', 'active') AS tmp
                                WHERE NOT EXISTS (
                                    SELECT type_name FROM note_types WHERE type_name = 'note'
                                ) LIMIT 1;`
	if _, err := DB.Exec(defaultNoteTypeSQL); err != nil {
		log.Fatalf("Failed to ensure default note type exists: %v", err)
	}
}
